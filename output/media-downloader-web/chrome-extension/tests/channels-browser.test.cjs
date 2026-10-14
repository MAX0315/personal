'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../channels.js');
const SOURCE = fs.readFileSync(path.join(__dirname, '../channels-browser.js'), 'utf8');
const SHARE = 'https://weixin.qq.com/sph/RequestedShare';
const PAGE = 'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=9007199254740993&token=SessionPageToken';
const MEDIA = 'https://finder.video.qq.com/251/20302/stodownload?encfilekey=Sign%2BCase%2F%3D&sig=keep+exact';
const VIDEO = { errCode: 0, data: { feedInfo: { description: '请求的视频', h264VideoInfo: { videoUrl: MEDIA, width: 1080, height: 1920, durationSeconds: 12.5 } }, recommendList: [{ videoUrl: 'https://finder.video.qq.com/other.mp4' }] } };
const parseResult = { code: 0, data: { playable_url: PAGE } };
const clone = value => JSON.parse(JSON.stringify(value));
function events() {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
    emit: (...args) => { for (const fn of Array.from(listeners)) fn(...args); }, get size() { return listeners.size; } };
}
function hashFor(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return '#__vod_browser_channels=test-extension.' + (hash >>> 0).toString(16);
}
function harness(options = {}) {
  let nextId = 100;
  const tabs = new Map((options.tabs || []).map(item => [item.id, { status: 'complete', active: false, pinned: false, ...item }]));
  const created = [], removed = [], injections = [], requests = [], updates = [], pageHeaders = [];
  const onUpdated = events(), onRemoved = events(), onActivated = events();
  const response = (payload, endpoint, extra = {}) => {
    const r = new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
      status: extra.status || 200, headers: { 'content-type': extra.contentType || 'application/json', ...(extra.headers || {}) }
    });
    Object.defineProperty(r, 'url', { value: extra.url || endpoint });
    Object.defineProperty(r, 'redirected', { value: !!extra.redirected });
    return r;
  };
  const chrome = {
    runtime: { id: 'test-extension' },
    tabs: {
      onUpdated, onRemoved, onActivated,
      query: async () => Array.from(tabs.values(), item => ({ ...item })),
      get: async id => { if (!tabs.has(id)) throw new Error('No tab'); return { ...tabs.get(id) }; },
      create: async spec => {
        const tab = { id: nextId++, status: options.loading ? 'loading' : 'complete', active: !!spec.active, pinned: false, url: spec.url };
        tabs.set(tab.id, tab); created.push({ ...tab });
        options.onCreate?.(tab, { tabs, onUpdated });
        return { ...tab };
      },
      update: async (id, spec) => { Object.assign(tabs.get(id), spec); updates.push({ id, ...spec }); if (spec.active) onActivated.emit({ tabId: id }); return { ...tabs.get(id) }; },
      remove: async id => { removed.push(id); tabs.delete(id); onRemoved.emit(id); }
    },
    scripting: { executeScript: async spec => {
      injections.push(spec);
      assert.equal(spec.world, 'MAIN');
      assert.equal(spec.target.frameIds, undefined);
      const tab = tabs.get(spec.target.tabId);
      if (!tab) throw new Error('No tab');
      options.beforeInjection?.(spec, tab, { tabs, onUpdated, onActivated });
      const location = {
        get href() { return tab.url; }, get origin() { return new URL(tab.url).origin; }
      };
      const pageApi = {
        marker: 'normal page identity',
        getYbCommonHeaders() { assert.equal(this, pageApi); return { 'X-From-Page': 'normal', 'X-Optional': undefined }; },
        async setContextualRequestHeaders(config) {
          assert.equal(this, pageApi); assert.ok(config.url.startsWith('/api/weixin/get_parse_result'));
          if (options.contextHeaderHang) await new Promise(() => {});
          config.headers['X-WebVersion'] = 'current-page-version';
        },
        getThirdPartyReqHeaders() { assert.equal(this, pageApi); return { 'X-Context': 'current-page-only' }; }
      };
      const pageContext = vm.createContext({ location, window: { $webApi: options.webApi === false ? null : pageApi },
        history: { state: null, replaceState: (_state, _title, value) => { tab.url = value; } },
        URL, AbortController, TextDecoder, TextEncoder,
        setTimeout: options.fastPageTimeout ? (fn, ms) => setTimeout(fn, ms >= 15000 ? 20 : ms) : setTimeout,
        clearTimeout, Date,
        fetch: async (endpoint, init) => {
          assert.equal(new URL(endpoint).origin, location.origin);
          assert.equal(init.credentials, 'include'); assert.equal(init.redirect, 'error');
          assert.equal(init.method, 'POST');
          assert.ok(!/127\.0\.0\.1|localhost/.test(endpoint));
          const body = JSON.parse(init.body);
          requests.push({ endpoint, body, tabId: tab.id });
          pageHeaders.push(init.headers);
          let r = options.fetch ? await options.fetch(endpoint, init, { body, tab, tabs, response, onUpdated, onActivated }) :
            response(endpoint.includes('/api/weixin/') ? parseResult : VIDEO, endpoint);
          return r;
        }
      });
      if (options.webApi === false) {
        let ticks = 0;
        vm.runInContext('Date = class extends Date { static now() { return globalThis.tick(); } }', Object.assign(pageContext, { tick: () => ticks += 1000 }));
      }
      const fn = vm.runInContext('(' + spec.func.toString() + ')', pageContext);
      const result = await fn(...spec.args);
      options.afterInjection?.(spec, tab, { tabs, onUpdated, onActivated });
      return [{ frameId: 0, result }];
    } }
  };
  const timeout = options.fastTimeout ? (fn, ms) => setTimeout(fn, ms >= 10000 ? 20 : ms) : setTimeout;
  const context = vm.createContext({ chrome, ChannelsExtractor: C, URL, Date, Math, setTimeout: timeout, clearTimeout });
  vm.runInContext(SOURCE, context, { filename: 'channels-browser.js' });
  return { api: context.BrowserChannels, tabs, created, removed, injections, requests, updates, pageHeaders, onUpdated, onActivated };
}

test('successful share chain uses normal-page request headers and exact feed only', async () => {
  const h = harness();
  const initial = await h.api.status();
  assert.equal(initial.authenticated, null); assert.equal(initial.verified, false);
  const result = await h.api.resolve(SHARE);
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].videoUrl, MEDIA);
  assert.equal(result.candidates[0].videoId, '9007199254740993');
  assert.equal(result.method, 'channels-browser'); assert.equal(result.browserOnly, true);
  assert.equal(result.shareUrl, SHARE);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[0].body, { type: 'video_channel_url', url: SHARE, scene: 1 });
  assert.deepEqual(h.requests[1].body, { baseReq: { generalToken: 'SessionPageToken' }, exportId: '9007199254740993' });
  assert.equal(new URL(h.requests[1].endpoint).searchParams.get('_pageUrl'), 'https://channels.weixin.qq.com/finder-preview/pages/feed');
  assert.ok(Math.abs(Number(new URL(h.requests[1].endpoint).searchParams.get('_rid')) - Date.now() / 1000) < 5);
  assert.equal(h.pageHeaders[0]['X-WebVersion'], 'current-page-version');
  assert.equal(h.pageHeaders[0]['X-Optional'], undefined);
  assert.equal(Object.hasOwn(h.pageHeaders[0], 'X-Optional'), false);
  assert.ok(!JSON.stringify(result).includes('current-page-only'));
  assert.equal(h.created.length, 2); assert.ok(h.created.every(tab => !tab.active));
  assert.deepEqual(h.removed, h.created.map(tab => tab.id));
  const after = await h.api.status(); assert.equal(after.authenticated, true); assert.equal(after.verified, true);
});

test('direct official token page skips Yuanbao and prefers user tab without closing it', async () => {
  const h = harness({ tabs: [{ id: 7, url: PAGE }, { id: 9, url: PAGE, active: true }] });
  const result = await h.api.resolve(PAGE, 9);
  assert.equal(result.candidates.length, 1); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].tabId, 9);
  assert.equal(h.created.length, 0); assert.equal(h.removed.length, 0);
  assert.equal((await h.api.status()).authenticated, null);
});

test('existing Yuanbao chat tab supplies its session without navigation or close', async () => {
  const url = 'https://yuanbao.tencent.com/chat/normal-user-page';
  const h = harness({ tabs: [{ id: 7, url, active: true }] });
  assert.equal((await h.api.resolve(SHARE, 7)).candidates.length, 1);
  assert.equal(h.requests[0].tabId, 7); assert.equal(h.tabs.get(7).url, url);
  assert.ok(!h.removed.includes(7)); assert.equal(h.updates.length, 0);
});

test('HTTP 401 is actionable login failure and login tab is opened only on user command', async () => {
  const h = harness({ fetch: (endpoint, _init, ctx) => ctx.response({ error: 'unauthorized' }, endpoint, { status: 401 }) });
  const result = await h.api.resolve(SHARE);
  assert.equal(result.reasonCode, 'auth'); assert.equal(result.needsLogin, true);
  assert.equal(result.loginUrl, 'https://yuanbao.tencent.com/'); assert.equal(result.candidates.length, 0);
  assert.equal(h.created.filter(tab => tab.active).length, 0);
  assert.equal((await h.api.status()).authenticated, false);
  const login = await h.api.openLogin();
  assert.equal(login.opened, true); assert.equal(h.tabs.get(login.tabId).active, true);
  assert.equal(h.tabs.get(login.tabId).url, result.loginUrl);
  assert.ok(!h.removed.includes(login.tabId));
});

test('normal API login payload is distinguished from other platform errors', async () => {
  const h = harness({ fetch: (endpoint, _init, ctx) => ctx.response({ code: 1001, msg: '请先登录' }, endpoint) });
  const result = await h.api.resolve(SHARE);
  assert.equal(result.needsLogin, true); assert.equal(result.reasonCode, 'auth');
  assert.equal(h.requests.length, 1); assert.equal(h.removed.length, 1);
});

test('missing current page request context does not fall back to unauthenticated bare fetch', async () => {
  const h = harness({ webApi: false });
  const result = await h.api.resolve(SHARE);
  assert.equal(result.reasonCode, 'page-init'); assert.equal(h.requests.length, 0);
  assert.equal(result.needsLogin, undefined); assert.equal(h.removed.length, 1);
});

test('hung official contextual-header promise is bounded by injected request timeout', async () => {
  const h = harness({ contextHeaderHang: true, fastPageTimeout: true });
  const result = await h.api.resolve(SHARE);
  assert.equal(result.reasonCode, 'timeout'); assert.equal(h.requests.length, 0);
  assert.equal(h.removed.length, 1);
});

test('expired playable page token returns expiry without claiming a login failure', async () => {
  const h = harness({ fetch: (endpoint, _init, ctx) => ctx.response(endpoint.includes('/api/weixin/') ? parseResult :
    { errCode: -1001, errMsg: 'token expired' }, endpoint) });
  const result = await h.api.resolve(SHARE);
  assert.equal(result.reasonCode, 'expired'); assert.equal(result.needsLogin, undefined);
  assert.equal(result.candidates.length, 0); assert.ok(result.error.includes('最新分享链接'));
  assert.equal(h.removed.length, 2);
});

test('official HTTP 403 is expired credential; Yuanbao HTTP 500 remains an HTTP error', async () => {
  const direct = harness({ fetch: (endpoint, _init, ctx) => ctx.response({}, endpoint, { status: 403 }) });
  assert.equal((await direct.api.resolve(PAGE)).reasonCode, 'expired');
  const remote = harness({ fetch: (endpoint, _init, ctx) => ctx.response({}, endpoint, { status: 500 }) });
  const failed = await remote.api.resolve(SHARE);
  assert.equal(failed.reasonCode, 'http'); assert.equal(failed.status, 500); assert.equal(failed.needsLogin, undefined);
  const forbidden = harness({ fetch: (endpoint, _init, ctx) => ctx.response({}, endpoint, { status: 403 }) });
  const denied = await forbidden.api.resolve(SHARE);
  assert.equal(denied.reasonCode, 'http'); assert.equal(denied.status, 403); assert.equal(denied.needsLogin, undefined);
});

test('network failure remains a network error and cleans the created tab', async () => {
  const h = harness({ fetch: async () => { throw new TypeError('fetch failed'); } });
  assert.equal((await h.api.resolve(SHARE)).reasonCode, 'network');
  assert.equal(h.created.length, 1); assert.equal(h.removed.length, 1);
});

test('cover-only result cannot be treated as a downloadable full video', async () => {
  const h = harness({ fetch: (endpoint, _init, ctx) => ctx.response({ errCode: 0, data: { feedInfo: { description: '仅封面', coverUrl: 'https://finder.video.qq.com/cover.jpg' } } }, endpoint) });
  const result = await h.api.resolve(PAGE);
  assert.equal(result.reasonCode, 'cover-only'); assert.equal(result.metadataOnly, true);
  assert.equal(result.candidates.length, 0); assert.ok(!result.error.includes('本地'));
});

test('wrong-domain playable URLs and incomplete official pages are rejected before feed request', async () => {
  for (const playable_url of ['https://channels.weixin.qq.com.evil.example/finder-preview/pages/feed?eid=e&token=t',
    'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=e',
    'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=e&token=t&token=z']) {
    const h = harness({ fetch: (endpoint, _init, ctx) => ctx.response({ code: 0, data: { playable_url } }, endpoint) });
    const result = await h.api.resolve(SHARE);
    assert.equal(result.reasonCode, 'invalid'); assert.equal(h.requests.length, 1); assert.equal(h.created.length, 1);
  }
});

test('HTTP response redirected to another domain is discarded', async () => {
  const h = harness({ fetch: (endpoint, _init, ctx) => ctx.response(parseResult, endpoint, { url: 'https://evil.example/result', redirected: true }) });
  assert.equal((await h.api.resolve(SHARE)).reasonCode, 'navigation');
  assert.equal(h.requests.length, 1); assert.equal(h.removed.length, 1);
});

test('tab changing domain before injection does not execute a fetch or close the adopted tab', async () => {
  const h = harness({ beforeInjection: (spec, tab) => { if (spec.args.length === 4) tab.url = 'https://example.com/user-navigation'; } });
  const result = await h.api.resolve(SHARE);
  assert.equal(result.reasonCode, 'navigation'); assert.equal(h.requests.length, 0);
  assert.equal(h.removed.length, 0); assert.equal(h.tabs.size, 1);
});

test('tab changing target after injection invalidates result and preserves navigated tab', async () => {
  const h = harness({ afterInjection: (spec, tab) => { if (spec.args.length === 4) tab.url = 'https://yuanbao.tencent.com/chat/user-navigation'; } });
  const result = await h.api.resolve(SHARE);
  assert.equal(result.reasonCode, 'navigation'); assert.equal(result.candidates.length, 0);
  assert.equal(h.removed.length, 0); assert.equal(h.tabs.size, 1);
});

test('user activating a temporary tab adopts it and removes only our URL marker', async () => {
  const h = harness({ beforeInjection: (spec, tab, ctx) => {
    if (spec.args.length === 4 && tab.url.startsWith('https://yuanbao.tencent.com/')) {
      tab.active = true; ctx.onActivated.emit({ tabId: tab.id });
    }
  } });
  assert.equal((await h.api.resolve(SHARE)).candidates.length, 1);
  const yuanbao = Array.from(h.tabs.values()).find(tab => tab.url.startsWith('https://yuanbao.tencent.com/'));
  assert.ok(yuanbao); assert.equal(yuanbao.url, 'https://yuanbao.tencent.com/');
  assert.ok(!h.removed.includes(yuanbao.id));
});

test('concurrent same-work parsing deduplicates requests and transient tabs', async () => {
  const h = harness();
  const [first, second] = await Promise.all([h.api.resolve(SHARE), h.api.resolve(SHARE)]);
  assert.equal(first.candidates[0].videoUrl, MEDIA); assert.equal(second.candidates[0].videoUrl, MEDIA);
  assert.equal(h.requests.length, 2); assert.equal(h.created.length, 2); assert.equal(h.removed.length, 2);
});

test('concurrent different shares share one Yuanbao tab and keep requests bound to their own work', async () => {
  const secondShare = 'https://weixin.qq.com/sph/SecondShare';
  const secondPage = 'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=second&token=second-token';
  const h = harness({ fetch: async (endpoint, _init, ctx) => {
    await Promise.resolve();
    if (endpoint.includes('/api/weixin/')) return ctx.response({ code: 0, data: { playable_url: ctx.body.url === secondShare ? secondPage : PAGE } }, endpoint);
    return ctx.response(VIDEO, endpoint);
  } });
  const [first, second] = await Promise.all([h.api.resolve(SHARE), h.api.resolve(secondShare)]);
  assert.equal(first.candidates[0].videoId, '9007199254740993'); assert.equal(second.candidates[0].videoId, 'second');
  assert.equal(h.created.filter(tab => tab.url.startsWith('https://yuanbao.tencent.com/')).length, 1);
  assert.equal(h.requests.length, 4); assert.equal(h.removed.length, 3);
});

test('restart cleanup closes only unchanged inactive extension-marked tabs', async () => {
  const root = 'https://yuanbao.tencent.com/';
  const h = harness({ tabs: [
    { id: 1, url: root + hashFor(root) },
    { id: 2, url: PAGE + hashFor(PAGE), active: true },
    { id: 3, url: root },
    { id: 4, url: 'https://yuanbao.tencent.com/chat/user' + hashFor(root) },
    { id: 5, url: 'https://evil.example/' + hashFor('https://evil.example/') }
  ] });
  await h.api.status();
  assert.deepEqual(h.removed, [1]);
  assert.equal(h.tabs.get(2).url, PAGE); assert.ok(h.tabs.has(3)); assert.ok(h.tabs.has(4)); assert.ok(h.tabs.has(5));
});

test('bounded loading timeout releases listeners and closes only its own tab', async () => {
  const h = harness({ loading: true, fastTimeout: true });
  const result = await h.api.resolve(SHARE);
  assert.equal(result.reasonCode, 'timeout'); assert.equal(h.removed.length, 1);
  assert.equal(h.onUpdated.size, 1); // Only the module's adoption guard remains.
});

test('onUpdated completion resumes normal parse without polling', async () => {
  const h = harness({ loading: true, onCreate: (tab, ctx) => {
    setTimeout(() => { tab.status = 'complete'; ctx.onUpdated.emit(tab.id, { status: 'complete' }, { ...tab }); }, 5);
  } });
  assert.equal((await h.api.resolve(SHARE)).candidates.length, 1);
  assert.equal(h.onUpdated.size, 1);
});

test('invalid user link performs no browser mutation or request', async () => {
  const h = harness();
  for (const url of ['http://weixin.qq.com/sph/x', 'https://evil.example/video', 'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=a&eid=b']) {
    assert.equal((await h.api.resolve(url)).reasonCode, 'invalid');
  }
  assert.equal(h.created.length, 0); assert.equal(h.requests.length, 0); assert.equal(h.injections.length, 0);
});

test('openLogin reuses a normal existing tab and concurrent commands create one login tab', async () => {
  const existing = harness({ tabs: [{ id: 4, url: 'https://yuanbao.tencent.com/chat/existing' }] });
  assert.equal((await existing.api.openLogin()).tabId, 4); assert.equal(existing.created.length, 0);
  const empty = harness();
  const [first, second] = await Promise.all([empty.api.openLogin(), empty.api.openLogin()]);
  assert.equal(first.tabId, second.tabId); assert.equal(empty.created.length, 1); assert.equal(empty.removed.length, 0);
});
