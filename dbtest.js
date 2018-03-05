'use strict';// test script
/* eslint-disable no-console */
var event = {
	'Records': [ { 's3': { 'bucket': { 'name': 'mybucket' }, 'object': { 'key': 'test.json' } } } ]
};

var context = {};
var callback = function(err, data) {
	if (err) console.log(err);
	if (data) console.log(data);
	return;
};

const index = require('./db.js');
index.handler(event, context, callback);
