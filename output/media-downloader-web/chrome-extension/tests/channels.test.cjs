'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../channels.js');
const SHARE = 'https://weixin.qq.com/sph/Aem9gUDNni';
const PAGE = 'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=ExportCase9007199254740993&token=NormalSessionToken';
const MEDIA = 'https://finder.video.qq.com/251/20302/stodownload?encfilekey=Sign%2BCase%2F%3D&sig=keep+this%2Fexact';
const VIDEO = { errCode: 0, data: { errMsg: { type: 0 }, feedInfo: { description: '测试视频号', h264VideoInfo: { videoUrl: MEDIA, width: 1080, height: 1920, durationSeconds: 12.5 }, h265VideoInfo: { videoUrl: 'https://finder.video.qq.com/h265.mp4' }, coverUrl: 'https://finder.video.qq.com/cover.jpg' } } };
const clone = value => JSON.parse(JSON.stringify(value));

test('native preview exports only recognition and observed feed extraction', () => {
  assert.deepEqual(Object.keys(C).sort(), ['extractFeed', 'isChannelsUrl', 'parsePage', 'safeMedia']);
  for (const name of ['fetchJson', 'resolveChannels', 'parseYuanbao']) assert.equal(C[name], undefined);
});

test('official share/preview routes preserve their exact target identifiers', () => {
  const share = C.parsePage(SHARE);
  assert.equal(share.shortUri, 'Aem9gUDNni');
  assert.equal(share.shareUrl, SHARE);
  assert.equal(share.pageUrl, 'https://channels.weixin.qq.com/finder-preview/pages/sph?id=Aem9gUDNni');
  assert.equal(C.parsePage('https://channels.weixin.qq.com/finder-preview/pages/sph?id=Aem9gUDNni').shareUrl, SHARE);
  assert.equal(C.parsePage(PAGE).exportId, 'ExportCase9007199254740993');
  assert.equal(C.parsePage(PAGE).token, 'NormalSessionToken');
  assert.equal(C.isChannelsUrl(SHARE), true);
});

test('credentials, HTTP, lookalike hosts and duplicate/incomplete identifiers are rejected', () => {
  for (const url of [
    'http://weixin.qq.com/sph/Aem9gUDNni', 'https://user:password@weixin.qq.com/sph/Aem9gUDNni',
    'https://weixin.qq.com.evil.example/sph/Aem9gUDNni', 'https://weixin.qq.com:4433/sph/Aem9gUDNni',
    'https://channels.weixin.qq.com/finder-preview/pages/user?eid=case',
    'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=',
    'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=a&eid=b',
    'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=a&token=x&token=y',
    'https://channels.weixin.qq.com/finder-preview/pages/sph?id=a&id=b'
  ]) { assert.equal(C.isChannelsUrl(url), false, url); assert.throws(() => C.parsePage(url)); }
});

test('observed feed prefers H264, preserves signature and binds the supplied target', () => {
  const payload = clone(VIDEO);
  payload.data.recommendList = [{ h264VideoInfo: { videoUrl: 'https://finder.video.qq.com/recommend.mp4' } }];
  const result = C.extractFeed(payload, C.parsePage(PAGE));
  assert.equal(result.candidates.length, 1);
  const item = result.candidates[0];
  assert.equal(item.videoUrl, MEDIA); assert.equal(item.codec, 'h264'); assert.equal(item.platform, 'channels');
  assert.equal(item.sourceRole, 'native-playback'); assert.equal(item.duration, 12.5);
  assert.equal(item.width, 1080); assert.equal(item.height, 1920); assert.equal(item.kind, 'video');
  assert.equal(item.videoId, 'ExportCase9007199254740993'); assert.ok(item.fileName.endsWith('.mp4'));
  assert.equal(result.matched, true);
});

test('fallbacks apply only when the preferred field is absent', () => {
  const payload = clone(VIDEO); delete payload.data.feedInfo.h264VideoInfo;
  assert.equal(C.extractFeed(payload).candidates[0].codec, 'h265');
  delete payload.data.feedInfo.h265VideoInfo; payload.data.feedInfo.videoUrl = MEDIA;
  assert.equal(C.extractFeed(payload).candidates[0].videoUrl, MEDIA);
  payload.data.feedInfo.h264VideoInfo = { videoUrl: 'https://localhost/private.mp4' };
  assert.equal(C.extractFeed(payload).candidates.length, 0);
});

test('covers, recommendations and platform failures cannot become video downloads', () => {
  const cover = C.extractFeed({ errCode: 0, data: { feedInfo: { description: '仅有封面', coverUrl: 'https://finder.video.qq.com/cover.jpg', picInfo: [{ url: 'https://finder.video.qq.com/image.jpg' }] } } });
  assert.equal(cover.candidates.length, 0); assert.equal(cover.metadataOnly, true);
  assert.ok(cover.error.includes('封面')); assert.ok(!cover.error.includes('本地微信助手'));
  assert.equal(C.extractFeed({ errCode: 0, data: { recommendList: [VIDEO.data.feedInfo] } }).candidates.length, 0);
  const warning = clone(VIDEO); warning.data.errMsg = { type: 4, title: '<b>请前往微信</b>' };
  const result = C.extractFeed(warning);
  assert.equal(result.candidates.length, 0); assert.ok(result.error.includes('请前往微信')); assert.ok(!result.error.includes('<b>'));
  for (const payload of [{ errCode: 9, data: VIDEO.data }, { data: VIDEO.data }, { errCode: '0', data: VIDEO.data }]) assert.equal(C.extractFeed(payload).candidates.length, 0);
});

test('observed playback excludes cover/partial/local/page/non-HTTPS addresses', () => {
  for (const url of [
    'data:video/mp4;base64,AAA', 'blob:https://channels.weixin.qq.com/id',
    'http://finder.video.qq.com/video.mp4', 'https://name:secret@finder.video.qq.com/video.mp4',
    'https://localhost/video.mp4', 'https://127.0.0.1/video.mp4', 'https://[::1]/video.mp4',
    'https://finder.video.qq.com/cover.jpg', 'https://finder.video.qq.com/cover/webp',
    'https://finder.video.qq.com/video.m3u8', 'https://finder.video.qq.com/segments/one',
    'https://finder.video.qq.com/video.mp4?range=0-200', 'https://finder.video.qq.com/video.mp4?format=image',
    'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=some'
  ]) {
    const payload = clone(VIDEO); payload.data.feedInfo.h264VideoInfo.videoUrl = url;
    assert.equal(C.extractFeed(payload).candidates.length, 0, url);
  }
});

test('raw encrypted CDN bytes are blocked; clear platform output is allowed', () => {
  for (const extra of [{ encrypted: true }, { decodeKey: '394253653' }, { decode_key: 'secret' }, { isEncrypted: 1 }]) {
    const payload = clone(VIDEO); Object.assign(payload.data.feedInfo.h264VideoInfo, extra);
    assert.equal(C.extractFeed(payload).candidates.length, 0); assert.equal(C.extractFeed(payload).protected, true);
  }
  const clear = clone(VIDEO); Object.assign(clear.data.feedInfo, { decodeKey: '', encrypted: false });
  Object.assign(clear.data.feedInfo.h264VideoInfo, { decodeKey: 0, encrypted: 'false' });
  assert.equal(C.extractFeed(clear).candidates[0].videoUrl, MEDIA);
});

test('ambiguous preview duration is ignored; explicit seconds/milliseconds retain units', () => {
  const payload = clone(VIDEO); payload.data.feedInfo.h264VideoInfo = { videoUrl: MEDIA, duration: 50000 };
  assert.equal(C.extractFeed(payload).candidates[0].duration, 0);
  payload.data.feedInfo.h264VideoInfo.durationMs = 50000;
  assert.equal(C.extractFeed(payload).candidates[0].duration, 50);
  payload.data.feedInfo.h264VideoInfo.durationSeconds = 50.5;
  assert.equal(C.extractFeed(payload).candidates[0].duration, 50.5);
});
