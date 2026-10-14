'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../extractor.js');
const SOURCE = fs.readFileSync(path.join(__dirname, '../douyin-browser.js'), 'utf8');
const ID = '7568826746301189418', OTHER = '7568826746301189419';
const PAGE = 'https://www.douyin.com/video/' + ID;
const SHORT = 'https://v.douyin.com/Z0wh2LKx4MI/';
const candidate = (extra = {}) => ({ videoId: ID, videoUrl: 'https://v3-web.douyinvod.com/matching.mp4?sig=exact+case', kind: 'video', platform: 'douyin', ...extra });
function events() {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
    emit: (...args) => { for (const fn of Array.from(listeners)) fn(...args); }, get size() { return listeners.size; } };
}
function runtime(options = {}) {
  const tabs = new Map((options.tabs || []).map(tab => [tab.id, { status: 'complete', active: false, pinned: false, ...tab }]));
  const created = [], removed = [], updates = [], injections = [];
  const onUpdated = events(), onRemoved = events(), onActivated = events();
  let next = 40, reads = 0;
  const chrome = {
    tabs: { onUpdated, onRemoved, onActivated,
      query: async () => Array.from(tabs.values(), tab => ({ ...tab })),
      get: async id => { if (!tabs.has(id)) throw new Error('no tab'); return { ...tabs.get(id) }; },
      create: async spec => {
        const tab = { id: next++, status: options.loading ? 'loading' : 'complete', pinned: false, ...spec };
        if (options.redirect) tab.url = options.redirect;
        tabs.set(tab.id, tab); created.push({ ...spec }); return { ...tab };
      },
      update: async (id, spec) => { const tab = tabs.get(id); Object.assign(tab, spec); updates.push({ id, ...spec }); if (spec.active) onActivated.emit({ tabId: id }); return { ...tab }; },
      remove: async id => { removed.push(id); tabs.delete(id); onRemoved.emit(id); }
    },
    scripting: { executeScript: async spec => {
      injections.push(spec); const tab = tabs.get(spec.target.tabId);
      assert.equal(spec.world, 'MAIN');
      options.beforeInjection?.(spec, tab, { onActivated, onUpdated });
      if (spec.files) return [];
      if (options.hung) return new Promise(() => {});
      reads++;
      const page = vm.createContext({ URL, location: { get href() { return tab.url; } }, VideoExtractor: E,
        document: { body: { innerText: options.text || '' } },
        __vodExtractCurrent: async () => options.candidates ?? [candidate()] });
      const result = await vm.runInContext('(' + spec.func.toString() + ')', page)(...spec.args);
      options.afterInjection?.(spec, tab);
      return [{ result }];
    } }
  };
  const context = vm.createContext({ URL, chrome, VideoExtractor: E, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)), clearTimeout });
  vm.runInContext(SOURCE, context);
  return { created, removed, updates, injections, tabs, onUpdated, onRemoved, onActivated,
    resolve: (url = SHORT, preferred, linked = { videoId: ID, pageUrl: PAGE }) => context.BrowserDouyin.resolve(url, preferred, linked), get reads() { return reads; } };
}
test('opens a normal target page when no existing tab matches, extracts target and cleans up an unused owned tab', async () => {
  const r = runtime(); const result = await r.resolve();
  assert.equal(r.created[0].url, PAGE); assert.equal(r.created[0].active, false);
  assert.equal(result.platform, 'douyin'); assert.equal(result.videoId, ID); assert.equal(result.method, 'browser-page');
  assert.equal(result.candidates[0].videoUrl, candidate().videoUrl); assert.equal(r.removed.length, 1);
  assert.equal(r.onUpdated.size, 0); assert.equal(r.onRemoved.size, 0); assert.equal(r.onActivated.size, 0);
});
test('reuses the preferred exact work tab and never closes or navigates it', async () => {
  const r = runtime({ tabs: [{ id: 1, url: PAGE }, { id: 2, url: PAGE + '?modal_id=' + ID }, { id: 3, url: 'https://www.douyin.com/video/' + OTHER }] });
  const result = await r.resolve(SHORT, 2);
  assert.equal(result.tabId, 2); assert.equal(result.method, 'existing-page');
  assert.equal(r.created.length, 0); assert.equal(r.removed.length, 0); assert.equal(r.updates.length, 0);
});
test('short share with no server ID can resolve through normal official redirect and load desktop target', async () => {
  const r = runtime({ redirect: 'https://www.iesdouyin.com/share/video/' + ID + '/' });
  const result = await r.resolve(SHORT, undefined, {});
  assert.equal(r.created[0].url, SHORT); assert.equal(r.updates[0].url, PAGE);
  assert.equal(result.videoId, ID); assert.equal(result.candidates.length, 1);
});
test('auth result keeps and activates the recovery page with Douyin-specific metadata', async () => {
  const r = runtime({ candidates: [], text: '请先登录抖音后观看' }); const result = await r.resolve();
  assert.equal(result.requiresPage, true); assert.equal(result.needsBridge, true); assert.equal(result.needsLogin, true);
  assert.equal(result.platform, 'douyin'); assert.equal(result.reasonCode, 'auth'); assert.equal(result.recoveryOpened, true);
  assert.equal(result.pageUrl, PAGE); assert.equal(result.videoId, ID); assert.equal(r.removed.length, 0); assert.equal(r.updates.at(-1).active, true);
  assert.ok(!result.error.includes('腾讯')); assert.equal(r.reads, 3);
});
test('verification result is truthful and does not create a fake media result', async () => {
  const r = runtime({ candidates: [], text: '请完成安全验证' }); const result = await r.resolve();
  assert.equal(result.reasonCode, 'verification'); assert.equal(result.matched, false); assert.equal(result.candidates.length, 0);
  assert.equal(result.needsLogin, false); assert.equal(r.removed.length, 0);
});
test('a comment login prompt cannot be reported as a video login requirement', async () => {
  const r = runtime({ candidates: [], text: '请先登录后发表评论' }); const result = await r.resolve();
  assert.equal(result.reasonCode, 'media-unavailable'); assert.equal(result.needsLogin, false); assert.equal(r.reads, 3);
});
test('other-work candidates and video-page posters are never accepted as target video', async () => {
  const r = runtime({ candidates: [candidate({ videoId: OTHER }), candidate({ kind: 'image' })] });
  const result = await r.resolve(); assert.equal(result.reasonCode, 'media-unavailable'); assert.equal(result.candidates.length, 0);
});
test('navigation during injection invalidates extracted target media', async () => {
  const r = runtime({ afterInjection: (_spec, tab) => { tab.url = 'https://www.douyin.com/video/' + OTHER; } });
  const result = await r.resolve(); assert.equal(result.reasonCode, 'identity'); assert.equal(result.matched, false); assert.equal(result.candidates.length, 0);
  assert.equal(r.removed.length, 0);
});
test('a short link redirect to a foreign origin is rejected without activation or injection', async () => {
  const r = runtime({ redirect: 'https://evil.example/video/' + ID }); const result = await r.resolve(SHORT, undefined, {});
  assert.equal(result.reasonCode, 'navigation'); assert.equal(r.injections.length, 0); assert.equal(r.updates.length, 0); assert.equal(r.removed.length, 0);
});
test('normal loading timeout is bounded, preserves recovery tab and detaches listeners', async () => {
  const r = runtime({ loading: true }); const result = await r.resolve();
  assert.equal(result.reasonCode, 'timeout'); assert.equal(result.requiresPage, true); assert.equal(r.removed.length, 0);
  assert.equal(r.onUpdated.size, 0); assert.equal(r.onRemoved.size, 0); assert.equal(r.onActivated.size, 0);
});
test('a hanging page extractor times out and leaves the real page available', async () => {
  const r = runtime({ hung: true }); const result = await r.resolve();
  assert.equal(result.reasonCode, 'timeout'); assert.equal(result.candidates.length, 0); assert.equal(r.removed.length, 0);
});
test('a user-adopted owned tab is retained after successful extraction', async () => {
  const r = runtime({ beforeInjection: (_spec, tab, { onActivated }) => { onActivated.emit({ tabId: tab.id }); } });
  const result = await r.resolve(); assert.equal(result.candidates.length, 1); assert.equal(r.removed.length, 0);
});
test('page hook never relabels a video poster or recommendation image as an image post', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../page-hook.js'), 'utf8');
  const extraction = { ...E, parseJson: () => null, extractFromHtml: () => [],
    extractDouyin: (data, id) => data?.aweme_id === id && data.image_post_info ? [candidate({ kind: 'image' })] : [] };
  const page = vm.createContext({ URL, VideoExtractor: extraction, location: { href: PAGE }, innerHeight: 1000,
    document: { scripts: [], querySelectorAll: () => [], images: [{ currentSrc: 'https://p3.douyinpic.com/cover.jpeg', naturalWidth: 1080, naturalHeight: 1920,
      getBoundingClientRect: () => ({ width: 320, height: 570, top: 0, bottom: 570 }) }] }, setTimeout, clearTimeout });
  vm.runInContext(source, page);
  const result = await page.__vodExtractCurrent(ID);
  assert.equal(result.length, 0); assert.equal(page.__vodExtractCurrent.vodVersion, '1.2.2');
});
test('page hook upgrades an existing old observer and same-version reinjection preserves one new wrapper', () => {
  const source = fs.readFileSync(path.join(__dirname, '../page-hook.js'), 'utf8');
  const old = Object.assign(async () => [candidate({ kind: 'image' })], { vodVersion: '1.2.1' });
  const originalFetch = async () => {};
  const page = vm.createContext({ URL, VideoExtractor: E, location: { href: PAGE }, document: {},
    __vodExtractCurrent: old, fetch: originalFetch, setTimeout, clearTimeout });
  vm.runInContext(source, page);
  const current = page.__vodExtractCurrent, wrapper = page.fetch;
  assert.notEqual(current, old); assert.equal(current.vodVersion, '1.2.2'); assert.notEqual(wrapper, originalFetch);
  vm.runInContext(source, page);
  assert.equal(page.__vodExtractCurrent, current); assert.equal(page.fetch, wrapper);
});
