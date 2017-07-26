"use strict";
const is_saveLocal = true;

// load packages
const AWS = require('aws-sdk');
const qs = require('querystring');
const twitter = require('twitter');
const request = require('request');
const fs = require('fs');

// get time
const date = new Date();
const hour = date.getHours();
const min = date.getMinutes();
const isEnableWatchdog = ((hour === 13 || hour === 1) && (min >= 56 || min <= 3)) ? true : false;

// get credentials
const credentials = {
	tweets_count:				process.env.tweets_count,
	targetID:					process.env.twtr_targetID,
	// since_id:				process.env.twtr_since_id,
	imgSavePath:				'images/',
	bucket:						process.env.aws_s3_saveBucket,
	twtr: {
		consumer_key:			process.env.twtr_consumer_key,
		consumer_secret:		process.env.twtr_consumer_secret,
		access_token_key:		process.env.twtr_access_token_key,
		access_token_secret:	process.env.twtr_access_token_secret
	},
	slack: {
		url:					process.env.slack_webhook_URL,
		icon_url:				process.env.slack_icon_url,
		username:				process.env.slack_username,
		channel:				process.env.slack_channel,
	},
	aws: {
		accessKeyId:			process.env.aws_accessKeyId,
		secretAccessKey:		process.env.aws_secretAccessKey,
		region:					process.env.aws_region
	}
};


const twitter_url = 'https://twitter.com/';
// init aws
// AWS.Config(credentials.aws);
const s3 = new AWS.S3(credentials.aws);

// dynamoDB
const twId = new class {
	constructor () {
		this.tw_target_id = 'niltea';
		this.dbParam = {
			TableName: 'twtr_fav',
		};
		this.dynamodb = new AWS.DynamoDB({
			region: credentials.aws.region
		});
	}
	putTweetsId (id) {
		const _dbParam = this.dbParam;
		_dbParam.Item = {
			target_id:  {"S": this.tw_target_id},
			tweet_last: {"N": id}
		};
		this.dynamodb.putItem(_dbParam, function(err, data) {
			if (err) {
				console.log(err, err.stack);
			} else {
				console.log(util.inspect(data, false, null));
			}
		});
	}
	getLastId () {
		return new Promise((resolve, reject) => {
			const _dbParam = this.dbParam;
			_dbParam.Key = {
				target_id: {"S": this.tw_target_id}
			};
			this.dynamodb.getItem(_dbParam, function(err, data) {
				if (err) reject(err, err.stack);
				const item = data.Item;
				const tweet_last = parseInt(item.tweet_last.N, 10);
				resolve(tweet_last);
			});
		});
	}
};

const postSlack = (slackPayload) => {
	const headers = { 'Content-Type':'application/json' };
	const options = { json: slackPayload };
	request.post(credentials.slack.url, options, (error, response, body) => {
		if (response.body !== 'ok') {
			console.log(error);
		}
	});
};

// Slackに投げるObjectの生成
const generateSlackPayload = (text, isWatchdog) => {
	const icon_url = credentials.slack.icon_url;
	const username = credentials.slack.username;
	const channel =  credentials.slack.channel;
	if (isWatchdog) {
		text = 'いきてるよー。';
	}
	return {icon_url, username, channel, text};
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

	// クエリパラメーター生成
	const fetchParam = {
		method:   'GET',
		url:      mediaIdURL.url,
		encoding: null,
		headers:  {
			'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/537.36 Safari/537.36'
		}
	};

	// 保存ファイルのメタデーター作成
	const fileMeta = {
		ext:             ext,
		dest:            dest,
		imgSavePath:     imgSavePath,
		fileName:        fileName,
		tweetScreenName: tweetScreenName,
		objectProp: {
			Bucket:      credentials.bucket,
			Key:         dest + fileName,
			ContentType: contentType
		}
	};
	return {fetchParam, fileMeta};
};

// 画像のフェッチを行う
const fetchImage = (fetchParam) => {
	return new Promise((resolve, reject) => {
		request(fetchParam, (err, res, body) => {
			if(!err && res.statusCode === 200){
				resolve(body);
			} else {
				reject(err);
			}
		});
	});
};

const saveLocal = (file, fileMeta) => {
	// save local
	fs.mkdir(fileMeta.imgSavePath, function(err) {
		if (err && err.code !== 'EEXIST'){
			console.log('code: %s', err.code);
			console.log('err: %s', err);
			return false;
		}
		fs.mkdir(fileMeta.dest, function(err) {
			if (err && err.code !== 'EEXIST'){
				console.log('err: %s', err);
				return false;
			}
			fs.writeFileSync(fileMeta.dest + fileMeta.fileName, file, 'binary');
		});
	});
};
const saveS3 = (file, fileMeta) => {
	console.log('saveS3')
	return;
	// 	const prop = requestParam.fileMeta.objectProp;
	// 	delete prop.ContentType;
	// 	s3.headObject(prop, function(err, result) {
	// 		if (err && err.statusCode === 404) {
	// 			if(requestParam.postSlack && !false) postSlack(payload);
	// 			fetchImage(requestParam);
	// 			return;
	// 		} else {
	// 			return false;
	// 		}
	// 	});
	// });
	fileMeta.objectProp.Body = file;
	s3.putObject(fileMeta.objectProp, function(err, result) {
		if (err) {
			console.log('========== err:S3 ==========');
			console.log(err);
			return false;
		} else {
			console.log('saved');
			return true;
		}
	});
};

// 画像の保存を行う
const saveImage = (file, requestParam, slackPayload) => {
	if(!file) {
		console.log('err: no body');
		return;
	}
	if(is_saveLocal) {
		saveLocal(file, requestParam.fileMeta);
	} else {
		saveS3(file, requestParam.fileMeta);
	}
	// if (slackPayload) postSlack(slackPayload);
};

// 画像のフェッチを行い、保存する
const fetchSaveImages = (tweet) => {
	const {mediaIdURL_arr, tweetScreenName, slackPayload} = tweet;
	const imgSavePath = credentials.imgSavePath;
	// 渡されたURLをForeachし、Fetchパラメーターを生成する
	let requestParam_arr = [];
	mediaIdURL_arr.forEach((mediaIdURL, mediaCount) => {
		const requestParam = setRequestParam(mediaIdURL, imgSavePath, tweetScreenName);
		requestParam.postSlack = (mediaCount === 0) ? true : false;

		// ないとは思うけど空だったら何もせずにreturn
		if(!requestParam) return;
		requestParam_arr.push(requestParam);
	});

	// パラメータをもとにファイルのFetchと保存
	requestParam_arr.forEach(async (requestParam) => {
		const file = await fetchImage(requestParam.fetchParam);
		const _slack = (requestParam.postSlack) ? slackPayload : null;
		// TODO: ファイルの存在確認
		saveImage(file, requestParam, _slack);
	});
};

const fetchFav = (callback) => {
	const params = {
		screen_name:	credentials.targetID,
		count:			credentials.tweets_count,
	};
	const endpoint = 'favorites/list.json';
	// init twitter
	const twitterClient = new twitter(credentials.twtr);
	// fetch tweets
	return new Promise((resolve, reject) => {
		twitterClient.get(endpoint , params, (error, tweets, response) => {
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
	variants.forEach (variant => {
		// mp4じゃなかったら帰る
		if(variant.content_type !== 'video/mp4') return;
		// もし今までの物よりビットレートが高ければ、上書きする
		if ( highest.bitrate < variant.bitrate) {
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
			return selectHighestBitrate (media.video_info.variants);
		})();
		mediaIdURLs.push({id, url});
	});
	return mediaIdURLs;
};

const formatTweets = (tweets_raw, callback) => {
	const tweetsCount = tweets_raw.length - 1;
	// 戻り値を格納する配列
	const tweets_arr = [];
	const tweets_IDs = [];
	let count = 0;
	tweets_raw.forEach((tweet) => {
		// TODO: IDが取得済みのものだったらreturnする処理

		// console.log(tweet.id_str);
		// return;
		// get tweer data
		const id = tweet.id_str;
		const user = tweet.user;
		const tweetScreenName = user.screen_name;
		const extended_entities = tweet.extended_entities;
		const mediaInPost = (extended_entities) ? extended_entities.media : null;
		// media付きでなければ戻る
		if (!mediaInPost) return;

		// mediaのURLを取得する
		const mediaIdURL_arr = parseMediaIdURLs(mediaInPost);

		// tweetのURLを生成
		const tweet_url = twitter_url + tweetScreenName + '/status/' + tweet.id_str;
		// slackに投げる文字列の生成
		const slackMsg = '@' + credentials.targetID + 'でfavした画像だよ。\n' + tweet_url;
		const slackPayload = generateSlackPayload(slackMsg);

		// 出力データをセット
		tweets_arr.push({id, tweetScreenName, mediaIdURL_arr, slackPayload});
		tweets_IDs.push(id);
		count += 1;
	});
	return {count, tweets_IDs, tweets_arr};
};

const hoge = () => {
	if (tweetsCount < 0) {
		// watchdogのタイミングだったらSlackに投げる
		if (isEnableWatchdog) {
			const slackPayload = generateSlackPayload(null, true);
			postSlack(slackPayload);
		}
		callback(null, 'no new tweet found.');
		return;
	}
};

exports.handler = async (event, context, callback) => {
	// const since_id = await twId.getLastId();
	const tweets_raw = await fetchFav(callback);
	const tweets_formatted = await formatTweets(tweets_raw, callback);

	// DBに取得済みのtweets_idを保存
	// twId.putTweetsId(tweets_formatted.tweets_IDs);
	// console.log(tweets_formatted.tweets_arr);
	tweets_formatted.tweets_arr.forEach(tweet => {
		fetchSaveImages(tweet);
	});
	console.log('count: %s', tweets_formatted.count);
};
