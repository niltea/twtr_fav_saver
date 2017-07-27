'use strict';// test script
/* eslint-disable no-console */
var event = {'target_id': 'niltea'};

var context = {};
var callback = function(err, data) {
	if (err) console.log(err);
	if (data) console.log(data);
	return;
};

const index = require('./index.js');
index.handler(event, context, callback);
