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

  putTweetsId(idArr) {
    const _dbParam = {
      TableName: this.TableName,
      Item     : {
        target_id: { 'S': credentials.targetID },
        tweets   : { 'L': this.formatID(idArr) }
      }
    };
    this.dynamodb.putItem(_dbParam, function (err) {
      if (err) {
        return err;
      }
    });
  }

  async getTweetsId() {
    return new Promise((resolve, reject) => {
      const _dbParam = {
        TableName: this.TableName,
        Key      : {
          'target_id': { 'S': credentials.targetID }
        },
      };
      this.dynamodb.getItem(_dbParam, function (err, data) {
        if (err) {
          reject(err, err.stack);
        }
        const item = data.Item;
        const tweetsList = [];
        if (item === undefined || item.tweets === undefined) {
          resolve(tweetsList);
        }
        item.tweets.L.forEach(item => {
          tweetsList.push(item.S);
        });
        resolve(tweetsList);
      });
    });
  }
};

const postSlack = async (slackPayload) => {
  const _url = url.parse(credentials.slack.url);
  const postParam = {
    method  : 'POST',
    hostname: _url.hostname,
    path    : _url.path
  };
  return new Promise((resolve, reject) => {
  const req = https.request(postParam, res => {
    if (res.statusCode !== 200) {
        console.log(`Error: postSlack(response error) - ${res.statusCode}`);
        reject();
      } else {
        console.log(`Posted to Slack.`);
        resolve();
      }
    });
    req.on('error', (err) => {
      console.log(`Error: postSlack - ${err}`);
      reject();
    });

    req.write(JSON.stringify(slackPayload));
    req.end();
  })
};

// Slackに投げるObjectの生成
const generateSlackPayload = (text) => {
  const icon_url = credentials.slack.icon_url;
  const username = credentials.slack.username;
  const channel = credentials.slack.channel;
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
const fetchImage = async (fetchParam) => {
  return new Promise((resolve, reject) => {
    const req = https.request(fetchParam, (res) => {
      let data = [];
      res.on('data', (chunk) => {
        // dataを積んでいく
        data.push(chunk);
      });
      res.on('end', () => {
        // データを結合して返す
        resolve(Buffer.concat(data));
      });
    });
    req.end();
    req.on('error', (err) => {
      reject(err);
    });
  });
};

// save local
const saveLocal = async ({ body, fileMeta, slackPayload }) => {
  fs.mkdir(fileMeta.imgSavePath, function (err) {
    if (err && err.code !== 'EEXIST') {
      console.log(`err: saveLocal - ${err}`);
      return false;
    }
    fs.mkdir(fileMeta.dest, function (err) {
      if (err && err.code !== 'EEXIST') {
        console.log(`Error: saveLocal - ${err}`);
        return false;
      }
      // 存在確認して保存済ならスキップ
      if (fs.existsSync(fileMeta.dest + fileMeta.fileName)) {
        console.log(`File exists, skipped: ${fileMeta.imgSavePath + fileMeta.dest + fileMeta.fileName}`);
        return false;
      }

      fs.writeFileSync(fileMeta.dest + fileMeta.fileName, body, 'binary');
      if (slackPayload) postSlack(slackPayload);
      console.log(`File saved to ${fileMeta.imgSavePath + fileMeta.dest + fileMeta.fileName}`);
    });
  });
};
const saveS3 = async ({ body, fileMeta, slackPayload }) => {
  console.log('called saveS3');
  // init S3
  const s3 = new AWS.S3(credentials.aws);

  const s3Prop = fileMeta.objectProp;
  s3Prop.Body = body;
  return new Promise((resolve, reject) => {
  // Objectの存在確認
    s3.headObject({ Bucket: s3Prop.Bucket, Key: s3Prop.Key }, (err, metadata) => {  
      if (!err || err.code !== 'NotFound') {
        console.log(`saveS3 - File exists, skipped: ${fileMeta.imgSavePath + fileMeta.dest + fileMeta.fileName}`);
        resolve();
      }
      if (err && err.code !== 'NotFound') {
        console.log(`Error: saveS3 headObject - ${err}`);
        reject(`Error: saveS3 headObject - ${err}`);
      }
      s3.putObject(s3Prop, function (err) {
        if (err) {
          console.log(`Error: saveS3 putObject - ${err}`);
          reject(`Error: saveS3 putObject - ${err}`);
        } else {
          console.log(`Saved to S3: ${s3Prop.Key}`);
          if (slackPayload) postSlack(slackPayload);
          resolve(`Saved to S3: ${s3Prop.Key}`);
        }
      });
    });
  }); 
};

// 画像の保存を行う
const saveImage = async (fileData) => {
  console.log('called saveImage');
  if (!fileData.body) {
    console.log('err: no body');
    return;
  }
  if (is_saveLocal) {
    await saveLocal(fileData);
  } else {
    await saveS3(fileData);
  }
};

// 画像のフェッチを行い、保存する
const fetchSaveImages = async (tweet) => {
  const { mediaIdURL_arr, tweetScreenName, tweetUserName } = tweet;
  const imgSavePath = credentials.imgSavePath;


  let slackMsg = `Saved image liked by @${credentials.targetID} \nTweeted by: ${tweetUserName}`;
  // 保存先URL
  const baseURI = `http://${credentials.domain}/`;
  // 渡されたURLをForeachし、Fetchパラメーターを生成する
  const lastIndex = mediaIdURL_arr.length - 1;

  return Promise.all(mediaIdURL_arr.map(async (mediaIdURL, mediaCount) => {
    const requestParam = setRequestParam(mediaIdURL, imgSavePath, tweetScreenName);
    requestParam.postSlack = (mediaCount === lastIndex);
    // ないとは思うけど空だったら何もせずにreturn
    if (!requestParam) return;
    // S3ファイルURIを積む
    slackMsg += `\n${baseURI}${requestParam.fileMeta.objectProp.Key}`;
    const slackPayload = (requestParam.postSlack) ? generateSlackPayload(slackMsg) : null;

    const body = await fetchImage(requestParam.fetchParam);
    await saveImage({
      body        : body,
      fileMeta    : requestParam.fileMeta,
      slackPayload: slackPayload,
    });
  }));
};

const fetchFav = async () => {
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
        reject(`Twitter fetch error\n${error}`);
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

// URLに付いてるクエリパラメーターを分離する
const splitQueries = (_url) => {
  const splitted = _url.split('?');
  // パラメーターがないとき
  if (!splitted[1]) return { url: splitted[0], params: undefined };

  const params = [];
  splitted[1].split('&').forEach((param) => {
    const query = param.split('=');
    params.push({
      name : query[0],
      value: query[1],
    });

  });
  return { url: splitted[0], params };
};

// 渡されたmediaデータの中からURLを取り出す
const parseMediaIdURLs = mediaArr => {
  if (mediaArr === null) return null;
  const mediaIdURLs = [];

  // arrayからURLを探し出す
  mediaArr.forEach(media => {
    const id = media.id_str;
    // URLを返してもらう即時関数
    const _url = (() => {
      // 動画以外であればすぐ取得できる
      if (media.type !== 'video') return media.media_url_https;
      // 動画の場合は複数URLの中からもっともビットレートの高い物を選ぶ
      return selectHighestBitrate(media.video_info.variants);
    })();
    const { url, params } = splitQueries(_url);
    mediaIdURLs.push({ id, url, params });
  });
  return mediaIdURLs;
};

const pruneTweets = (tweets_raw, tweets_saved) => {
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
    if (!mediaInPost) {
      console.log(`No media found, skipping: ${id}`);
      return null;
    }
    // 保存済IDに該当TweetのIDがある⇒保存済なので戻る
    if (tweets_saved.indexOf(id) >= 0) {
      console.log(`Saved before, skipping: ${id}`);
      return null;
    }

    console.log(`Not saved before, add tweet to query: ${id}`);

    // mediaのURLを取得する
    const mediaIdURL_arr = parseMediaIdURLs(mediaInPost);

    // 出力データをセット
    tweets_arr.push({ id, tweetUserName, tweetScreenName, mediaIdURL_arr });
    tweetsCount += 1;
  });
  return { tweetsCount, tweets_IDs, tweets_arr };
};

exports.handler = async (event) => {
  credentials.targetID = event.target_id || 'niltea';
  credentials.imgSavePath = event.imgSavePath || 'images/';
  credentials.slack.channel = event.slackChannel || env.slack_channel;
  credentials.slack.username = event.slackName || env.slack_username;
  credentials.slack.icon_url = event.slackIcon || env.slack_icon_url;
  // tweetと保存済みtweet一覧を取得してくる
  const tweets_raw = await fetchFav();
  const tweets_saved = await twId.getTweetsId();

  const tweets_formatted = pruneTweets(tweets_raw, tweets_saved);
  if (tweets_formatted.tweetsCount <= 0) {
    // watchdogのタイミング(0/12時0-9分)だったら生存確認をSlackに投げる
    const date = new Date();
    const hour = date.getHours();
    const min = date.getMinutes();
    const isRunWatchdog = ((hour === 12 || hour === 0) && (0 <= min && min <= 9));
    // 今はその""時""ではない……!!!
    if (!isRunWatchdog) return 'No new tweet found.';

    // watchDogを投げる
    const slackPayload = generateSlackPayload('いきてるよー。');
    await postSlack(slackPayload);
    return 'No new tweet found, and posted watchDog.';
  }
  console.log('===== New tweet(s) found, saving. =====');
  await Promise.all(tweets_formatted.tweets_arr.map(async tweet => {
    await fetchSaveImages(tweet);
  }));
  console.log('===== Saving IDs. =====');
  // 取得済みのtweets_idをDBに保存
  //twId.putTweetsId(tweets_formatted.tweets_IDs);
  console.log(`Tweet(s) successfully saved - count: ${tweets_formatted.tweetsCount}`);
  return `Tweet(s) successfully saved - count: ${tweets_formatted.tweetsCount}`;
};
