'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const SAMPLE = 'https://weixin.qq.com/sph/A8jXnmP4cc';
const MEDIA = 'https://finder.video.qq.com/251/20302/stodownload?encfilekey=fixture%2B1&token=fixture+2%2Fexact&idx=1';
const candidate = (extra = {}) => ({ videoUrl: MEDIA, videoId: 'A8jXnmP4cc', title: '测试作品', fileName: '测试作品.mp4', kind: 'video', platform: 'channels', ...extra });
function mp4Prefix() {
  const bytes = Buffer.alloc(32); bytes.writeUInt32BE(32, 0); bytes.write('ftypisom', 4); bytes.write('isommp42', 16);
  return new Response(bytes, { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-31/5000000' } });
}
function runtime({ result, fetchFn, tabs = [], scriptFn } = {}) {
  const saved = {}, downloads = [], registrations = [], requests = [], browserCalls = [], scripts = [], panelCalls = [];
  const context = vm.createContext({
    URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Response, Request, Headers, Uint8Array, DataView, TypeError,
    crypto: webcrypto, console, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async (value, options) => { requests.push({ value, options }); return (fetchFn || mp4Prefix)(value, options); },
    chrome: {
      runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p, onMessage: { addListener: f => registrations.push(f) } },
      sidePanel: { setPanelBehavior: async options => panelCalls.push(options) },
      storage: { session: {
        get: async key => key == null ? { ...saved } : { [key]: saved[key] },
        set: async entries => Object.assign(saved, entries),
        remove: async keys => (Array.isArray(keys) ? keys : [keys]).forEach(key => delete saved[key])
      } },
      tabs: { query: async () => tabs, get: async id => tabs.find(t => t.id === id) },
      scripting: { executeScript: async request => { scripts.push(request); return scriptFn ? scriptFn(request) : []; } },
      downloads: { download: async item => { downloads.push(item); return 42; }, onChanged: { addListener() {} }, search: async () => [] }
    }
  });
  context.importScripts = (...files) => files.forEach(file => {
    if (file === 'channels-browser.js') {
      context.BrowserChannels = {
        resolve: async (...args) => { browserCalls.push(args); return result || { candidates: [candidate()], platform: 'channels', matched: true, method: 'channels-browser' }; },
        openLogin: async () => ({ opened: true, tabId: 8 }),
        status: async () => ({ available: true, authenticated: null, verified: false })
      };
    } else vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), context, { filename: 'background.js' });
  return { context, saved, downloads, registrations, requests, browserCalls, scripts, panelCalls, run: code => vm.runInContext(code, context) };
}
function panelMessage(r, message, sender = { id: 'test', url: 'chrome-extension://test/popup.html' }) {
  return new Promise(resolve => {
    const accepted = r.registrations[0](message, sender, resolve);
    if (!accepted) resolve({ accepted: false });
  });
}
function stored(r, item = candidate(), created = Date.now()) { r.saved['result:fixture'] = { candidates: [item], created }; }

test('browser resolver receives requested target, keeps signed media and caches a result', async () => {
  const r = runtime(); const result = await r.run(`analyze({pageUrl:${JSON.stringify(SAMPLE)},tabId:7})`);
  assert.equal(result.candidates[0].videoUrl, MEDIA); assert.ok(result.token);
  assert.equal(r.browserCalls[0][0], SAMPLE); assert.equal(r.browserCalls[0][1], 7);
  assert.equal(r.saved['result:' + result.token].pageUrl, SAMPLE);
  assert.equal(r.requests.length, 0); assert.equal(r.downloads.length, 0);
  assert.equal(r.panelCalls[0].openPanelOnActionClick, true);
});
test('Douyin fallback starts the normal-browser adapter and stores only its matching result token', async () => {
  const r = runtime(), id = '7568826746301189418', page = 'https://www.douyin.com/video/' + id;
  r.context.LinkResolver.resolveDouyin = async () => ({ candidates: [], videoId: id, pageUrl: page, reason: '公开页面需要浏览器' });
  const calls = [];
  r.context.BrowserDouyin.resolve = async (...args) => { calls.push(args); return { candidates: [candidate({ videoId: id, platform: 'douyin' })],
    videoId: id, pageUrl: page, platform: 'douyin', matched: true, method: 'browser-page' }; };
  const result = await r.run("analyze({pageUrl:'https://v.douyin.com/Z0wh2LKx4MI/',tabId:7})");
  assert.equal(calls[0][0], 'https://v.douyin.com/Z0wh2LKx4MI/'); assert.equal(calls[0][1], 7); assert.equal(calls[0][2].videoId, id);
  assert.ok(result.token); assert.equal(r.saved['result:' + result.token].videoId, id); assert.equal(r.saved['result:' + result.token].platform, 'douyin');
  assert.equal(r.browserCalls.length, 0);
});
test('login / cover-only / HTTP failures do not create downloadable results', async () => {
  for (const result of [{ error: '登录已失效', needsLogin: true }, { error: '只有封面', metadataOnly: true }, { error: 'HTTP 403', stage: 'yuanbao' }]) {
    const r = runtime({ result }); const parsed = await r.run(`analyze({pageUrl:${JSON.stringify(SAMPLE)}})`);
    assert.equal(parsed.error, result.error); assert.equal(Object.keys(r.saved).length, 0); assert.equal(r.downloads.length, 0);
  }
});
test('panel message can open normal browser login and state never fabricates authenticated status', async () => {
  const r = runtime(); assert.equal((await panelMessage(r, { type: 'channelsLogin' })).tabId, 8);
  const state = await panelMessage(r, { type: 'channelsBrowserStatus' }); assert.equal(state.authenticated, null); assert.equal(state.verified, false);
  for (const type of ['channelsLogin', 'channelsBrowserStatus', 'download', 'startAnalysis']) {
    assert.equal((await panelMessage(r, { type, pageUrl: SAMPLE }, { id: 'test', tab: { id: 2 }, url: SAMPLE })).accepted, false);
  }
});
test('analysis status restores completed browser job without repeating the resolver', async () => {
  const r = runtime(); const start = await panelMessage(r, { type: 'startAnalysis', pageUrl: SAMPLE });
  let state;
  for (let i = 0; i < 15; i++) {
    state = await panelMessage(r, { type: 'analysisStatus' });
    if (state.state !== 'running') break;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(state.state, 'complete'); assert.equal(state.jobId, start.jobId);
  assert.equal((await panelMessage(r, { type: 'analysisStatus' })).result.token, state.result.token);
  assert.equal(r.browserCalls.length, 1);
});
test('MP4 is probed with Range then downloaded without a partial Range header', async () => {
  const r = runtime(); stored(r); const downloaded = await r.run("download({token:'fixture',index:0})");
  assert.equal(downloaded.id, 42); assert.equal(r.requests[0].value, MEDIA); assert.equal(r.requests[0].options.headers.Range, 'bytes=0-65535');
  assert.equal(r.downloads[0].url, MEDIA); assert.equal(r.downloads[0].headers, undefined); assert.equal(r.downloads[0].conflictAction, 'uniquify');
});
test('expired results stop before downloading', async () => {
  const r = runtime(); stored(r, candidate(), Date.now() - 16 * 60 * 1000);
  await assert.rejects(r.run("download({token:'fixture',index:0})"), /过期/); assert.equal(r.requests.length, 0);
});
test('local and segmented Channels sources cannot reintroduce helper dependency', async () => {
  for (const videoUrl of ['http://127.0.0.1:2022/play?key=123', 'https://localhost/video.mp4', 'https://finder.video.qq.com/a.m3u8']) {
    const r = runtime(); stored(r, candidate({ videoUrl }));
    await assert.rejects(r.run("download({token:'fixture',index:0})"), /地址无效/); assert.equal(r.requests.length, 0);
  }
});
for (const [label, response] of [
  ['HTML', () => new Response('<html>登录</html>', { headers: { 'Content-Type': 'text/html' } })],
  ['encrypted prefix', () => new Response(Buffer.alloc(64, 121), { headers: { 'Content-Type': 'video/mp4' } })],
  ['wrong range', () => new Response(Buffer.alloc(64), { status: 206, headers: { 'Content-Range': 'bytes 100-163/500000' } })],
  ['JSON', () => Response.json({ code: 400 })],
  ['HTTP forbidden', () => new Response('forbidden', { status: 403 })]
]) test(label + ' response is rejected before Chrome saves a video', async () => {
  const r = runtime({ fetchFn: response }); stored(r);
  await assert.rejects(r.run("download({token:'fixture',index:0})")); assert.equal(r.downloads.length, 0);
});
test('unprocessed decode key stops before fetching media bytes', async () => {
  const r = runtime(); stored(r, candidate({ decodeKey: '18446744073709551615' }));
  await assert.rejects(r.run("download({token:'fixture',index:0})"), /解码/); assert.equal(r.requests.length, 0);
});
test('header-only short response does not pass MP4 validation', async () => {
  const bytes = Buffer.alloc(16); bytes.writeUInt32BE(16, 0); bytes.write('ftypisom', 4);
  const r = runtime({ fetchFn: () => new Response(bytes, { headers: { 'Content-Type': 'video/mp4' } }) }); stored(r);
  await assert.rejects(r.run("download({token:'fixture',index:0})"), /只有文件头/); assert.equal(r.downloads.length, 0);
});
test('other platforms preserve existing download path', async () => {
  const r = runtime({ fetchFn: () => { throw new Error('must not probe'); } });
  stored(r, candidate({ platform: 'douyin', kind: 'image', videoUrl: 'https://p3-sign.douyinpic.com/test.jpg', fileName: '图1.jpg' }));
  await r.run("download({token:'fixture',index:0})"); assert.equal(r.downloads[0].filename, '图1.jpg'); assert.equal(r.requests.length, 0);
});
test('same official page source is accepted; another work cannot be substituted', async () => {
  for (const id of ['A8jXnmP4cc', 'OtherTarget']) {
    const r = runtime({ tabs: [{ id: 9, url: 'https://channels.weixin.qq.com/finder-preview/pages/sph?id=A8jXnmP4cc' }],
      scriptFn: async request => request.func ? [{ result: [candidate({ videoId: id })] }] : [] });
    const result = await r.run(`analyze({pageUrl:${JSON.stringify(SAMPLE)},tabId:9})`);
    assert.equal(result.candidates[0].videoUrl, MEDIA); assert.equal(r.browserCalls.length, id === 'A8jXnmP4cc' ? 0 : 1);
  }
});
test('production UI bindings and manifest use side panel with no local helper', () => {
  const js = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  for (const [, id] of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(html.includes(`id="${id}"`), id);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '1.8.2'); assert.equal(manifest.side_panel.default_path, 'popup.html'); assert.equal(manifest.action.default_popup, undefined);
  assert.ok(manifest.permissions.includes('sidePanel')); assert.ok(!manifest.permissions.includes('nativeMessaging')); assert.ok(!manifest.permissions.includes('cookies'));
  assert.ok(html.includes('1.8.2')); assert.ok(!html.includes('启动微信助手.exe')); assert.ok(!fs.existsSync(path.join(ROOT, 'channels-local.js')));
  for (const entry of manifest.content_scripts) for (const file of entry.js) assert.ok(fs.existsSync(path.join(ROOT, file)), file);
});
