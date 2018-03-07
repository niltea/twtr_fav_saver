'use strict';// test script
/* eslint-disable no-console */
const event = {
  target_id   : 'niltea_vt',
  imgSavePath : 'images_vt/',
  slackChannel: '_shizurin',
  slackName   : '静凛',
  slackIcon   : 'http://twitter-images.nilgiri-tea.net/asset/icon_shizurin.jpg',
};
const context = {};
const callback = function (err, data) {
  if (err) console.log(err);
  if (data) console.log(data);
};

const index = require('./index.js');
index.handler(event, context, callback);
