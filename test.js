'use strict';// test script
/* eslint-disable no-console */
const event = {
  target_id   : 'niltea_vt',
  imgSavePath : 'images_vt/',
  slackChannel: '_twitter_fav',
  slackName   : 'twitter fav test',
  slackIcon   : 'http://twitter-images.nilgiri-tea.net/assets/ishida.jpg',
};
const context = {};
const callback = function (msg) {
  if (msg) console.log(msg);
};

const index = require('./index.js');
index.handler(event, context, callback);
