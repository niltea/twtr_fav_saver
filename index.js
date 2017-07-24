"use strict";
const is_saveLocal = false;

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
	count:						20,
	targetID:					process.env.twtr_targetID,
	since_id:					process.env.twtr_since_id,
	twtr: {
		consumer_key:			process.env.twtr_consumer_key,
		consumer_secret:		process.env.twtr_consumer_secret,
		access_token_key:		process.env.twtr_access_token_key,
		access_token_secret:	process.env.twtr_access_token_secret
	},
	slack: {
		webhook_URL:			process.env.slack_webhook_URL,
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

// init twitter
const twitter_url = 'https://twitter.com/';
const twitterClient = new twitter(credentials.twtr);

// init aws
// AWS.Config(credentials.aws);
const s3 = new AWS.S3();

const mediaURLsParse = mediaArr => {
	if (mediaArr === null) return null;
	const mediaURLs = [];

	// arrayからURLを探し出す
	mediaArr.forEach(media => {
		const id = media.id_str;
		// URLを返してもらう即時関数
		const url = (() => {
			// 動画以外であればすぐ取得できる
			if (media.type !== 'video') return media.media_url_https;
			// 動画の場合は複数URLの中からもっともビットレートの高い物を選ぶ
			const variants = media.video_info.variants;
			// 空の物を用意しておく
			let highestVariant = { bitrate: 0 };
			variants.forEach (variant => {
				// mp4じゃなかったら帰る
				if(variant.content_type !== 'video/mp4') return;
				// もし今までの物よりビットレートが高ければ、上書きする
				if ( highestVariant.bitrate < variant.bitrate) {
					highestVariant = variant;
				}
			});
			return highestVariant.url;
		})();
		mediaURLs.push({id, url});
	});
	return mediaURLs;
};

const fetchFav = (context, callback) => {
	const params = {
		screen_name:	credentials.targetID,
		count:			credentials.count,
		// since_id:		credentials.since_id,
	};
	const endpoint = 'favorites/list.json';
	let lastID = 0;
	let firstID = 0;

	twitterClient.get(endpoint , params, (error, tweets, response) => {
		// エラーが発生してたらメッセージを表示して終了
		if (error) {
			console.error('twtr fetch error');
			callback('twtr fetch error');
			return;
		}

		const l = tweets.length - 1;
		if (l < 0) {
			callback(null, 'no new tweet found.');
			return;
		}
		tweets.forEach((tweet) => {
			// get tweer data
			const user = tweet.user;
			const screen_name = user.screen_name;
			const extended_entities = tweet.extended_entities;
			const media = (extended_entities) ? extended_entities.media : null;
			const media_arr = mediaURLsParse(media);

			const tweet_url = twitter_url + screen_name + '/status/' + tweet.id_str;
			let text = '@' + credentials.targetID + 'でfavした画像だよ。\n' + tweet_url;
		// 	const payload = generateSlackPayload(text, isEnableWatchdog);

			if(media_arr) {
				console.log(media_arr);
		// 		saveImages(media_arr, screen_name , false, payload);
			}
			console.log(tweet_url);

			// set tweet IDs
			if (lastID === 0) { lastID = tweet.id_str; }
			firstID = tweet.id_str;
		});
		console.log('count: %s, first: %s, last: %s', l + 1,  firstID, lastID);
	});
};

exports.handler = (event, context, callback) => {
	fetchFav(context);
};