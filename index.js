'use strict';
/* eslint-disable no-console */
/*global process:false Buffer:false*/
const is_saveLocal = false;

// load packages
const AWS = require('aws-sdk');
const Twitter = require('twitter');
const https = require('https');
const url = require('url');
const fs = require('fs');

// get time
const date = new Date();
const hour = date.getHours();
const min = date.getMinutes();
const isEnableWatchdog = ((hour === 13 || hour === 1) && (0 <= min && min <= 9));

// get credentials
const env = process.env;
const credentials = {
  tweets_count: 20,
  targetID    : null,
  imgSavePath : 'images/',
  bucket      : env.aws_s3_saveBucket,
  domain      : env.aws_s3_domain,
  twtr        : {
    consumer_key       : env.twtr_consumer_key,
    consumer_secret    : env.twtr_consumer_secret,
    access_token_key   : env.twtr_access_token_key,
    access_token_secret: env.twtr_access_token_secret
  },
  slack       : {
    url     : env.slack_webhook_URL,
    icon_url: env.slack_icon_url,
    username: null,
    channel : null,
  },
  aws         : {
    accessKeyId    : env.aws_accessKeyId,
    secretAccessKey: env.aws_secretAccessKey,
    region         : env.aws_region
  }
};

// dynamoDB
const twId = new class {
  constructor() {
    this.TableName = 'twtr_fav';
    this.dynamodb = new AWS.DynamoDB({
      region: credentials.aws.region
    });
  }

  formatID(idArr) {
    const idArr_formatted = [];
    idArr.forEach(id => {
      idArr_formatted.push({ S: id });
    });
    return idArr_formatted;
  }

  putTweetsId(idArr, callback) {
    const _dbParam = {
      TableName: this.TableName,
      Item     : {
        target_id: { 'S': credentials.targetID },
        tweets   : { 'L': this.formatID(idArr) }
      }
    };
    this.dynamodb.putItem(_dbParam, function (err) {
      if (err) {
        callback(err, err.stack);
      }
    });
  }

  getTweetsId(callback) {
    return new Promise((resolve, reject) => {
      const _dbParam = {
        TableName: this.TableName,
        Key      : {
          target_id: { 'S': credentials.targetID }
        }
      };
      this.dynamodb.getItem(_dbParam, function (err, data) {
        if (err) {
          reject(err, err.stack);
          callback(err);
        }
        const item = data.Item;
        const tweetsList = [];
        if (item === undefined || item.tweets === undefined) {
          resolve(tweetsList);
          return;
        }
        item.tweets.L.forEach(item => {
          tweetsList.push(item.S);
        });
        resolve(tweetsList);
      });
    });
  }
};

const postSlack = (slackPayload, callback) => {
  const _url = url.parse(credentials.slack.url);
  const postParam = {
    method  : 'POST',
    hostname: _url.hostname,
    path    : _url.path
  };
  const req = https.request(postParam, res => {
    if (res.statusCode !== 200) {
      callback('err - postSlack: ' + res.statusCode);
    }
  });
  req.on('error', (err) => {
    console.log(err);
    callback('err - postSlack');
  });

  req.write(JSON.stringify(slackPayload));
  req.end();
};

// Slackに投げるObjectの生成
const generateSlackPayload = (text, isWatchdog) => {
  const icon_url = credentials.slack.icon_url;
  const username = credentials.slack.username;
  const channel = credentials.slack.channel;
  if (isWatchdog) {
    text = 'いきてるよー。';
  }
  return { icon_url, username, channel, text, as_user: true };
};

const setRequestParam = (mediaIdURL, imgSavePath, tweetScreenName) => {
  // URLが入ってなかったらreturn
  if (mediaIdURL.url === undefined) return false;

  const dest = imgSavePath + tweetScreenName + '/';
  const ext = mediaIdURL.url.match(/\.[a-zA-Z0-9]+$/)[0];
  const fileName = mediaIdURL.id + ext;
  // content typeを拡張子から判定
  const contentType = (() => {
    if (ext === '.jpg') return 'image/jpeg';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.png') return 'image/png';
    if (ext === '.bmp') return 'image/x-bmp';
    if (ext === '.mp4') return 'image/mp4';
    return null;
  })();
  const _url = url.parse(mediaIdURL.url);
  // クエリパラメーター生成
  const fetchParam = {
    method  : 'GET',
    hostname: _url.hostname,
    path    : _url.path,
  };

  // 保存ファイルのメタデーター作成
  const fileMeta = {
    ext            : ext,
    dest           : dest,
    imgSavePath    : imgSavePath,
    fileName       : fileName,
    tweetScreenName: tweetScreenName,
    objectProp     : {
      Bucket     : credentials.bucket,
      Key        : dest + fileName,
      ContentType: contentType
    }
  };
  return { fetchParam, fileMeta };
};

// 画像のフェッチを行う
const fetchImage = (fetchParam) => {
  return new Promise((resolve, reject) => {
    const req = https.request(fetchParam, (res) => {
      let data = [];
      res.on('data', (chunk) => {
        data.push(chunk);
      });
      res.on('end', () => {
        resolve(Buffer.concat(data));
      });
    });
    req.end();
    req.on('error', (err) => {
      reject(err);
    });
  });
};

const saveLocal = ({ body, fileMeta, slackPayload }, callback) => {
  // save local
  fs.mkdir(fileMeta.imgSavePath, function (err) {
    if (err && err.code !== 'EEXIST') {
      callback(`err: ${err}`);
      return false;
    }
    fs.mkdir(fileMeta.dest, function (err) {
      if (err && err.code !== 'EEXIST') {
        callback(`err: ${err}`);
        return false;
      }
      fs.writeFileSync(fileMeta.dest + fileMeta.fileName, body, 'binary');
      callback(null, `Saved to Local: ${fileMeta.dest + fileMeta.fileName}`);
      if (slackPayload) postSlack(slackPayload, callback);
    });
  });
};
const saveS3 = ({ body, fileMeta, slackPayload }, callback) => {
  // init S3
  const s3 = new AWS.S3(credentials.aws);

  const s3Prop = fileMeta.objectProp;
  s3Prop.Body = body;
  s3.putObject(s3Prop, function (err) {
    if (err) {
      callback(err);
      return false;
    } else {
      callback(null, `Saved to S3: ${s3Prop.Key}`);
      if (slackPayload) postSlack(slackPayload);
      return true;
    }
  });
};

// 画像の保存を行う
const saveImage = (fileData, callback) => {
  if (!fileData.body) {
    callback('err: no body');
    return;
  }
  if (is_saveLocal) {
    saveLocal(fileData, callback);
  } else {
    saveS3(fileData, callback);
  }
};

// 画像のフェッチを行い、保存する
const fetchSaveImages = (tweet, callback) => {
  const { mediaIdURL_arr, tweetScreenName, tweetUserName } = tweet;
  const imgSavePath = credentials.imgSavePath;

  let slackMsg = `@${credentials.targetID} の新着favを見つけました！\nTweet by: ${tweetUserName}`;
  // 渡されたURLをForeachし、Fetchパラメーターを生成する
  let requestParam_arr = [];
  mediaIdURL_arr.forEach((mediaIdURL, mediaCount) => {
    const requestParam = setRequestParam(mediaIdURL, imgSavePath, tweetScreenName);
    requestParam.postSlack = (mediaCount === 0);

    // ないとは思うけど空だったら何もせずにreturn
    if (!requestParam) return;
    requestParam_arr.push(requestParam);
  });

  // 保存先URL
  const baseURI = `http://${credentials.domain}/`;
  // パラメータをもとにファイルのFetchと保存
  requestParam_arr.forEach((requestParam) => {
    // S3ファイルURIを積む
    slackMsg += `\n${baseURI}${requestParam.fileMeta.objectProp.Key}`;
    const _slack = (requestParam.postSlack) ? generateSlackPayload(slackMsg) : null;
    fetchImage(requestParam.fetchParam).then(body => {
      saveImage({
        body        : body,
        fileMeta    : requestParam.fileMeta,
        slackPayload: _slack
      }, callback);
    });
  });
};

const fetchFav = (callback) => {
  const params = {
    screen_name: credentials.targetID,
    count      : credentials.tweets_count,
  };
  const endpoint = 'favorites/list.json';
  // init twitter
  const twitterClient = new Twitter(credentials.twtr);
  // fetch tweets
  return new Promise((resolve, reject) => {
    twitterClient.get(endpoint, params, (error, tweets) => {
      // エラーが発生してたらメッセージを表示して終了
      if (error) {
        reject('twtr fetch error');
        callback('twtr fetch error', 'twtr fetch error');
        return;
      }
      resolve(tweets);
    });
  });
};

// もっともビットレートの高い動画を選ぶ
const selectHighestBitrate = variants => {
  // 空の物を用意しておく
  let highest = { bitrate: 0 };
  variants.forEach(variant => {
    // mp4じゃなかったら帰る
    if (variant.content_type !== 'video/mp4') return;
    // もし今までの物よりビットレートが高ければ、上書きする
    if (highest.bitrate < variant.bitrate) {
      highest = variant;
    }
  });
  return highest.url;
};

// 渡されたmediaデータの中からURLを取り出す
const parseMediaIdURLs = mediaArr => {
  if (mediaArr === null) return null;
  const mediaIdURLs = [];

  // arrayからURLを探し出す
  mediaArr.forEach(media => {
    const id = media.id_str;
    // URLを返してもらう即時関数
    const url = (() => {
      // 動画以外であればすぐ取得できる
      if (media.type !== 'video') return media.media_url_https;
      // 動画の場合は複数URLの中からもっともビットレートの高い物を選ぶ
      return selectHighestBitrate(media.video_info.variants);
    })();
    mediaIdURLs.push({ id, url });
  });
  return mediaIdURLs;
};

const formatTweets = (tweets_raw, tweets_saved) => {
  // 戻り値を格納する配列
  const tweets_arr = [];
  const tweets_IDs = [];
  let tweetsCount = 0;
  tweets_raw.forEach((tweet) => {
    // get tweet data
    const id = tweet.id_str;
    const user = tweet.user;
    const tweetUserName = user.name;
    const tweetScreenName = user.screen_name;
    const extended_entities = tweet.extended_entities;
    const mediaInPost = (extended_entities) ? extended_entities.media : null;

    // 処理したIDを突っ込んでおく
    tweets_IDs.push(id);
    // media付きでなければ戻る
    if (!mediaInPost) return;
    if (tweets_saved.indexOf(id) >= 0) return;

    // mediaのURLを取得する
    const mediaIdURL_arr = parseMediaIdURLs(mediaInPost);

    // 出力データをセット
    tweets_arr.push({ id, tweetUserName, tweetScreenName, mediaIdURL_arr });
    tweetsCount += 1;
  });
  return { tweetsCount, tweets_IDs, tweets_arr };
};

exports.handler = (event, context, callback) => {
  credentials.targetID = event.target_id || 'niltea';
  credentials.imgSavePath = event.imgSavePath || 'images/';
  credentials.slack.channel = event.slackChannel || env.slack_channel;
  credentials.slack.username = event.slackName || env.slack_username;
  credentials.slack.icon_url = event.slackIcon || env.slack_icon_url;

  // tweetと保存済みtweet一覧を取得してくる
  const promise_tweets = fetchFav(callback);
  const promise_savedID = twId.getTweetsId(callback);
  Promise.all([promise_savedID, promise_tweets]).then((retVal) => {
    const tweets_saved = retVal[0];
    const tweets_raw = retVal[1];
    const tweets_formatted = formatTweets(tweets_raw, tweets_saved);
    if (tweets_formatted.tweetsCount <= 0) {
      // watchdogのタイミングだったらSlackに投げる
      if (isEnableWatchdog) {
        const slackPayload = generateSlackPayload(null, true);
        postSlack(slackPayload, callback);
      }
      callback(null, 'no new tweet found.');
      return;
    }
    tweets_formatted.tweets_arr.forEach(tweet => {
      fetchSaveImages(tweet, callback);
    });
    // DBに取得済みのtweets_idを保存
    twId.putTweetsId(tweets_formatted.tweets_IDs, callback);
    callback(null, `count: ${tweets_formatted.tweetsCount}`);
  });
};
