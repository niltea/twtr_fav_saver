'use strict';// test script
/* eslint-disable no-console */
const event = { 'target_id': 'niltea_vt', 'imgSavePath': 'images_vt/' };

const context = {};
const callback = function (err, data) {
  if (err) console.log(err);
  if (data) console.log(data);
};

const index = require('./index.js');
index.handler(event, context, callback);
