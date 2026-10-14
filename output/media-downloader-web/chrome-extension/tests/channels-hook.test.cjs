'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extractorSource = fs.readFileSync(path.join(__dirname, '../channels.js'), 'utf8');
const hookSource = fs.readFileSync(path.join(__dirname, '../channels-hook.js'), 'utf8');
const PAGE_A = 'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=TargetCaseA&token=normalSession';
const PAGE_B = 'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=TargetCaseB&token=normalSession';
const ENDPOINT = 'https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info';
const MEDIA_A = 'https://finder.video.qq.com/a.mp4?sig=Signed%2BCase%2F%3D';
const MEDIA_B = 'https://finder.video.qq.com/b.mp4';
const BODY_A = JSON.stringify({ baseReq: { generalToken: 'normalSession' }, exportId: 'TargetCaseA' });
const BODY_B = JSON.stringify({ baseReq: { generalToken: 'normalSession' }, exportId: 'TargetCaseB' });
const video = (url = MEDIA_A) => ({ errCode: 0, data: { errMsg: { type: 0 }, feedInfo: { description: '测试作品', h264VideoInfo: { videoUrl: url } } } });
const response = (payload = video(), options = {}) => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json', ...options.headers }, status: options.status || 200 });
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness(options = {}) {
  let now = 1000000;
  const responses = [];
  const calls = [];
  const pending = [];
  class MockXHR {
    constructor() { this.events = new Map(); this.responseType = ''; this.status = 0; }
    open(...args) { this.openArgs = args; }
    send(body) { this.sentBody = body; this.sendCalls = (this.sendCalls || 0) + 1; }
    addEventListener(name, listener, config) {
      const list = this.events.get(name) || [];
      list.push({ listener, once: Boolean(config?.once) });
      this.events.set(name, list);
    }
    complete(payload, config = {}) {
      this.status = config.status || 200;
      this.responseType = config.responseType || '';
      this.response = payload;
      this.responseText = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const listeners = [...(this.events.get('load') || [])];
      this.events.set('load', listeners.filter(item => !item.once));
      for (const item of listeners) item.listener.call(this, { type: 'load' });
    }
  }
  const originalFetch = function (...args) {
    calls.push({ args, thisValue: this });
    const next = responses.length ? responses.shift() : response();
    const promise = Promise.resolve(next);
    pending.push(promise);
    return promise;
  };
  const context = vm.createContext({
    location: { href: options.pageUrl || PAGE_A },
    fetch: originalFetch,
    XMLHttpRequest: MockXHR,
    URL, TextDecoder, TextEncoder, Response, Request, AbortController,
    setTimeout, clearTimeout,
    Date: { now: () => now },
    console
  });
  vm.runInContext(extractorSource, context, { filename: 'channels.js' });
  const inject = () => vm.runInContext(hookSource, context, { filename: 'channels-hook.js' });
  inject();
  return {
    context, calls, pending, originalFetch, inject,
    enqueue: value => responses.push(value),
    current: () => context.__vodExtractChannelsCurrent?.() || [],
    navigate: url => { context.location.href = url; },
    advance: ms => { now += ms; },
    request: (body = BODY_A, endpoint = ENDPOINT) => context.fetch(endpoint, { method: 'POST', body })
  };
}

test('a document_start observer captures the native response for the current target', async () => {
  const h = harness();
  const original = response();
  h.enqueue(original);
  const promise = h.request();
  assert.equal(promise, h.pending[0], 'fetch wrapper returns the original promise');
  assert.equal(await promise, original, 'fetch wrapper returns the original Response');
  await flush();
  const candidates = h.current();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].videoId, 'TargetCaseA');
  assert.equal(candidates[0].videoUrl, MEDIA_A);
  assert.equal(candidates[0].platform, 'channels');
});

test('observing a cloned response leaves the caller body readable and arguments intact', async () => {
  const h = harness();
  const received = await h.request();
  const nativePayload = await received.json();
  await flush();
  assert.equal(nativePayload.data.feedInfo.h264VideoInfo.videoUrl, MEDIA_A);
  assert.equal(h.calls[0].args[0], ENDPOINT);
  assert.equal(h.calls[0].args[1].body, BODY_A);
  assert.equal(h.calls[0].args[1].method, 'POST');
  assert.equal(h.current()[0].videoUrl, MEDIA_A);
});

test('another target and recommendation/API requests never populate or overwrite current media', async () => {
  const h = harness();
  h.enqueue(response(video(MEDIA_B)));
  await h.request(BODY_B);
  await flush();
  assert.equal(h.current().length, 0);
  h.enqueue(response(video(MEDIA_B)));
  await h.request(BODY_A, 'https://channels.weixin.qq.com/finder-preview/api/feed/get_recommend');
  await flush();
  assert.equal(h.current().length, 0);
  h.enqueue(response());
  await h.request();
  await flush();
  assert.equal(h.current()[0].videoUrl, MEDIA_A);
  h.enqueue(response(video(MEDIA_B)));
  await h.request(BODY_B);
  h.enqueue(response(video(MEDIA_B)));
  await h.request(BODY_A, 'https://unrelated.example/finder-preview/api/feed/get_feed_info');
  await flush();
  assert.equal(h.current().length, 1);
  assert.equal(h.current()[0].videoUrl, MEDIA_A);
});

test('navigation to another official target cannot return the old captured candidates', async () => {
  const h = harness();
  await h.request();
  await flush();
  assert.equal(h.current()[0].videoUrl, MEDIA_A);
  h.navigate(PAGE_B);
  assert.equal(h.current().length, 0);
  h.enqueue(response(video(MEDIA_B)));
  await h.request(BODY_B);
  await flush();
  assert.equal(h.current()[0].videoUrl, MEDIA_B);
  assert.equal(h.current()[0].videoId, 'TargetCaseB');
});

test('a previous target response arriving after navigation is discarded', async () => {
  const h = harness();
  let complete;
  h.enqueue(new Promise(resolve => { complete = resolve; }));
  const request = h.request();
  h.navigate(PAGE_B);
  complete(response());
  const received = await request;
  assert.equal((await received.json()).data.feedInfo.h264VideoInfo.videoUrl, MEDIA_A);
  await flush();
  assert.equal(h.current().length, 0);
});

test('reinjecting the same hook preserves one fetch/XHR wrapper and current extractor', async () => {
  const h = harness();
  const wrappedFetch = h.context.fetch;
  const wrappedOpen = h.context.XMLHttpRequest.prototype.open;
  const wrappedSend = h.context.XMLHttpRequest.prototype.send;
  const extract = h.context.__vodExtractChannelsCurrent;
  h.inject();
  assert.equal(h.context.fetch, wrappedFetch);
  assert.equal(h.context.XMLHttpRequest.prototype.open, wrappedOpen);
  assert.equal(h.context.XMLHttpRequest.prototype.send, wrappedSend);
  assert.equal(h.context.__vodExtractChannelsCurrent, extract);
  assert.equal(extract.vodVersion, '1.8.2');
  await h.request();
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.current().length, 1);
});

test('XHR observes the matching request body without changing native open/send behavior', () => {
  const h = harness();
  const xhr = new h.context.XMLHttpRequest();
  xhr.open('POST', ENDPOINT, true, 'native-arg');
  xhr.send(BODY_A);
  assert.equal(xhr.openArgs[0], 'POST');
  assert.equal(xhr.openArgs[1], ENDPOINT);
  assert.equal(xhr.openArgs[3], 'native-arg');
  assert.equal(xhr.sentBody, BODY_A);
  assert.equal(xhr.sendCalls, 1);
  xhr.complete(video(), { responseType: 'json' });
  assert.equal(h.current()[0].videoUrl, MEDIA_A);
});

test('XHR ignores mismatched bodies and unsuccessful responses, and handles text JSON', () => {
  const h = harness();
  const other = new h.context.XMLHttpRequest();
  other.open('POST', ENDPOINT);
  other.send(BODY_B);
  other.complete(video(MEDIA_B), { responseType: 'json' });
  assert.equal(h.current().length, 0);
  const failed = new h.context.XMLHttpRequest();
  failed.open('POST', ENDPOINT);
  failed.send(BODY_A);
  failed.complete(video(), { status: 401 });
  assert.equal(h.current().length, 0);
  const valid = new h.context.XMLHttpRequest();
  valid.open('POST', ENDPOINT);
  valid.send(BODY_A);
  valid.complete(video(), { responseType: 'text' });
  assert.equal(h.current()[0].videoUrl, MEDIA_A);
});

test('cover-only and warning responses remove a previously captured download candidate', async () => {
  const h = harness();
  await h.request();
  await flush();
  assert.equal(h.current().length, 1);
  h.enqueue(response({ errCode: 0, data: { feedInfo: { coverUrl: 'https://finder.video.qq.com/cover.jpg' } } }));
  await h.request();
  await flush();
  assert.equal(h.current().length, 0);
  await h.request();
  await flush();
  assert.equal(h.current().length, 1);
  h.enqueue(response({ errCode: 0, data: { errMsg: { type: 4, title: '请前往微信' }, feedInfo: video().data.feedInfo } }));
  await h.request();
  await flush();
  assert.equal(h.current().length, 0);
});

test('bounded response reading ignores oversized or malformed JSON', async () => {
  const h = harness();
  h.enqueue(response(video(), { headers: { 'Content-Length': String(4 * 1024 * 1024 + 1) } }));
  await h.request();
  await flush();
  assert.equal(h.current().length, 0);
  h.enqueue(new Response('invalid JSON', { headers: { 'Content-Type': 'application/json' } }));
  await h.request();
  await flush();
  assert.equal(h.current().length, 0);
});

test('captures an official sph shortUri and expires metadata after 15 minutes', async () => {
  const h = harness({ pageUrl: 'https://channels.weixin.qq.com/finder-preview/pages/sph?id=AvS0meGELz' });
  await h.request(JSON.stringify({ baseReq: { generalToken: '' }, shortUri: 'AvS0meGELz' }));
  await flush();
  assert.equal(h.current()[0].videoId, 'AvS0meGELz');
  h.advance(15 * 60 * 1000 + 1);
  assert.equal(h.current().length, 0);
});
