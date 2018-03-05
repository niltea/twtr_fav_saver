'use strict';
/*global process:false*/
// load packages
const AWS = require('aws-sdk');
const util = require('util');


// get credentials
const credentials = {
	imgSavePath:				'images/',
	bucket:						process.env.aws_s3_saveBucket,
	aws: {
		accessKeyId:			process.env.aws_accessKeyId,
		secretAccessKey:		process.env.aws_secretAccessKey,
		region:					process.env.aws_region
	}
};


// init aws
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
	putLastId (id) {
		const _dbParam = this.dbParam;
		_dbParam.Item = {
			target_id:  {'S': this.tw_target_id},
			tweet_last: {'N': id}
		};
		return new Promise((resolve, reject) => {
			this.dynamodb.putItem(_dbParam, function(err, data) {
				if (err) {
					reject(err, err.stack);
				} else {
					resolve(util.inspect(data, false, null));
				}
			});
		});
	}
	getLastId () {
		return new Promise((resolve, reject) => {
			const _dbParam = this.dbParam;
			_dbParam.Key = {
				target_id: {'S': this.tw_target_id}
			};
			this.dynamodb.getItem(_dbParam, function(err, data) {
				if (err) reject(err, err.stack);
				resolve(util.inspect(data, false, null));
			});
		});
	}
	getDesc () {
		return new Promise((resolve, reject) => {
			const _dbParam = this.dbParam;
			this.dynamodb.describeTable(_dbParam, function(err, data) {
				if (err) reject(err, err.stack);
				resolve(util.inspect(data, false, null));
			});
		});
	}
};

exports.handler = (event, context, callback) => {
	const ret = twId.getLastId();
	Promise(ret).then((val) => {callback(val);});
};