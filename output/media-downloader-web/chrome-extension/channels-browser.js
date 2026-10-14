/* Browser-session Channels adapter. No helper, cookie export, or account-token storage. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BrowserChannels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const YUANBAO = 'https://yuanbao.tencent.com';
  const LOGIN_URL = YUANBAO + '/';
  const CHANNELS = 'https://channels.weixin.qq.com';
  const FEED_API = CHANNELS + '/finder-preview/api/feed/get_feed_info';
  const PARSE_API = YUANBAO + '/api/weixin/get_parse_result';
  const LOAD_MS = 15000, REQUEST_MS = 15000, SCRIPT_MS = 19000;
  const owned = new Map(), creating = new Map(), resolving = new Map();
  let startup, loginOpening, authenticated = null, checkedAt = 0;
  const C = () => root.ChannelsExtractor || (typeof require === 'function' ? require('./channels.js') : null);
  const chromeApi = () => root.chrome;
  const withoutHash = value => { try { const u = new URL(value); u.hash = ''; return u.href; } catch (_) { return ''; } };
  function fingerprint(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16);
  }
  function marker(pageUrl) { return '#__vod_browser_channels=' + chromeApi().runtime.id + '.' + fingerprint(pageUrl); }
  function exact(tab, expected) {
    return withoutHash(tab?.url) === expected && (!tab.pendingUrl || withoutHash(tab.pendingUrl) === expected);
  }
  function error(message, reasonCode, extra = {}) { return Object.assign(new Error(message), { reasonCode }, extra); }
  function authError() {
    return error('请在 Chrome 内登录腾讯元宝，然后回到插件重新解析。', 'auth', { needsLogin: true, loginUrl: LOGIN_URL });
  }
  function failure(message, info = {}, extra = {}) {
    return { candidates: [], reason: message, error: message, platform: 'channels', matched: false,
      pageUrl: info.pageUrl || '', shareUrl: info.shareUrl || '', ...extra };
  }
  function authPayload(payload) {
    const message = String(payload?.msg || payload?.message || payload?.error?.message || '');
    return payload?.needsLogin || payload?.status === 401 || payload?.code === 401 || payload?.code === -401 ||
      /未登录|请[^。]*登录|登录(?:已)?(?:过期|失效)|unauthori[sz]ed|not logged in|login required/i.test(message);
  }
  function expiredPayload(payload) {
    const warning = payload?.data?.errMsg;
    return /(?:token|票据|凭证|链接).*(?:expired|过期|失效|invalid)|(?:expired|invalid).*token/i.test(
      String(payload?.errMsg || payload?.msg || '') + ' ' + String(warning?.title || '') + ' ' + String(warning?.content || ''));
  }
  function withTimeout(promise, milliseconds, timeoutError) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError), milliseconds); })])
      .finally(() => clearTimeout(timer));
  }

  // This function is serialized into the official page's MAIN world. Headers
  // produced by that normal page remain there and are never returned or saved.
  async function requestInPage(expected, endpoint, body, timeoutMs) {
    const clean = value => { const u = new URL(value); u.hash = ''; return u.href; };
    const matches = () => clean(location.href) === expected;
    if (!matches() || new URL(endpoint).origin !== location.origin) return { ok: false, kind: 'navigation' };
    const u = new URL(endpoint);
    const allowed = u.origin === 'https://yuanbao.tencent.com' && u.pathname === '/api/weixin/get_parse_result' ||
      u.origin === 'https://channels.weixin.qq.com' && u.pathname === '/finder-preview/api/feed/get_feed_info';
    if (!allowed) return { ok: false, kind: 'navigation' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let reader;
    async function bounded(operation) {
      let onAbort;
      try {
        return await Promise.race([Promise.resolve(operation), new Promise((_, reject) => {
          onAbort = () => reject(new Error('request timeout'));
          if (controller.signal.aborted) onAbort();
          else controller.signal.addEventListener('abort', onAbort, { once: true });
        })]);
      } finally { if (onAbort) controller.signal.removeEventListener('abort', onAbort); }
    }
    try {
      const config = { url: u.pathname + u.search, method: 'post', data: body,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } };
      if (u.origin === 'https://yuanbao.tencent.com') {
        // Use the website's own current request context if its app has exposed it.
        // Avoid hardcoded WebVersion, copied fingerprints, and private module IDs.
        const deadline = Date.now() + 5000;
        while (typeof window.$webApi?.getYbCommonHeaders !== 'function' || typeof window.$webApi?.setContextualRequestHeaders !== 'function') {
          if (!matches()) return { ok: false, kind: 'navigation' };
          if (Date.now() >= deadline) return { ok: false, kind: 'page-init' };
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        const pageApi = window.$webApi;
        Object.assign(config.headers, await bounded(pageApi.getYbCommonHeaders()));
        await bounded(pageApi.setContextualRequestHeaders(config));
        if (typeof pageApi.getThirdPartyReqHeaders === 'function') Object.assign(config.headers, await bounded(pageApi.getThirdPartyReqHeaders()));
        for (const key of Object.keys(config.headers)) if (config.headers[key] === undefined || config.headers[key] === null) delete config.headers[key];
      }
      if (!matches()) return { ok: false, kind: 'navigation' };
      const response = await bounded(fetch(endpoint, { method: 'POST', body: JSON.stringify(body), headers: config.headers,
        credentials: 'include', redirect: 'error', cache: 'no-store', signal: controller.signal }));
      if (!matches() || response.redirected || response.url && clean(response.url) !== clean(endpoint)) return { ok: false, kind: 'navigation' };
      if (!response.ok) return { ok: false, kind: 'http', status: response.status };
      const maxBytes = 4 * 1024 * 1024;
      if (Number(response.headers.get('content-length') || 0) > maxBytes) return { ok: false, kind: 'oversize' };
      const type = response.headers.get('content-type') || '';
      if (type && !/json|text\/plain/i.test(type)) return { ok: false, kind: 'invalid' };
      let text = '';
      if (response.body?.getReader) {
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        while (true) {
          const chunk = await bounded(reader.read());
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maxBytes) { controller.abort(); return { ok: false, kind: 'oversize' }; }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } else {
        text = await bounded(response.text());
        if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, kind: 'oversize' };
      }
      if (!matches()) return { ok: false, kind: 'navigation' };
      // Preserve 64-bit identifiers before JSON.parse rounds them.
      let out = '', quoted = false, escaped = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) { out += ch; if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; }
        else if (ch === '"') { quoted = true; out += ch; }
        else if (ch === '-' || /\d/.test(ch)) {
          const token = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i))?.[0];
          if (!token) { out += ch; continue; }
          out += /^-?\d{16,}$/.test(token) ? JSON.stringify(token) : token;
          i += token.length - 1;
        } else out += ch;
      }
      try { return { ok: true, payload: JSON.parse(out.replace(/^\uFEFF/, '')) }; }
      catch (_) { return { ok: false, kind: 'invalid' }; }
    } catch (_) { return { ok: false, kind: controller.signal.aborted ? 'timeout' : 'network' }; }
    finally { clearTimeout(timer); if (reader) { try { await reader.cancel(); } catch (_) {} } }
  }

  async function detachMarker(record) {
    try {
      await chromeApi().scripting.executeScript({ target: { tabId: record.id }, world: 'MAIN',
        func: (expected, expectedHash) => {
          const u = new URL(location.href);
          if (u.hash !== expectedHash) return;
          u.hash = '';
          if (u.href === expected) history.replaceState(history.state, '', u.href);
        }, args: [record.expected, record.hash] });
    } catch (_) {}
  }
  async function dispose(record) {
    if (!record || record.refs) return;
    record.disposing = true;
    try {
      const tab = await chromeApi().tabs.get(record.id);
      if (!exact(tab, record.expected) || new URL(tab.url).hash !== record.hash) return;
      if (record.adopted || tab.active || tab.pinned) { await detachMarker(record); return; }
      await chromeApi().tabs.remove(record.id);
    } catch (_) {}
    finally { owned.delete(record.id); }
  }
  async function cleanupRestartTabs() {
    const chrome = chromeApi();
    if (!chrome?.runtime?.id || !chrome.tabs) return;
    chrome.tabs.onActivated?.addListener(info => { const r = owned.get(info.tabId); if (r) r.adopted = true; });
    chrome.tabs.onUpdated?.addListener((id, change) => {
      const r = owned.get(id);
      if (r && (change.pinned || change.url && withoutHash(change.url) !== r.expected)) r.adopted = true;
    });
    let tabs;
    try { tabs = await chrome.tabs.query({}); } catch (_) { return; }
    for (const tab of tabs) {
      try {
        const u = new URL(tab.url), expected = withoutHash(tab.url);
        if (u.hash !== marker(expected)) continue;
        if (u.origin === YUANBAO ? u.pathname !== '/' : !C().isChannelsUrl(expected)) continue;
        await dispose({ id: tab.id, expected, hash: u.hash, refs: 0, adopted: !!tab.active || !!tab.pinned });
      } catch (_) {}
    }
  }
  function ready() { return startup || (startup = cleanupRestartTabs()); }

  async function waitForTab(record) {
    const chrome = chromeApi();
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (problem, tab) => {
        if (done) return; done = true; clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(changed);
        chrome.tabs.onRemoved?.removeListener(removed);
        problem ? reject(problem) : resolve(tab);
      };
      const inspect = tab => {
        if (done) return;
        if (exact(tab, record.expected)) { if (tab.status === 'complete') finish(null, tab); return; }
        if (tab.status === 'loading' && withoutHash(tab.pendingUrl) === record.expected) return;
        finish(error('解析页面发生了跳转，请重新解析。', 'navigation'));
      };
      const changed = (id, _change, tab) => { if (id === record.id) inspect(tab); };
      const removed = id => { if (id === record.id) finish(error('解析页面已关闭，请重试。', 'navigation')); };
      const timer = setTimeout(() => finish(error('腾讯网页加载超时，请检查网络后重试。', 'timeout')), LOAD_MS);
      chrome.tabs.onUpdated.addListener(changed);
      chrome.tabs.onRemoved?.addListener(removed);
      chrome.tabs.get(record.id).then(inspect, () => finish(error('解析页面已关闭，请重试。', 'navigation')));
    });
  }

  async function acquire(pageUrl, preferredTabId, originOnly = false) {
    await ready();
    const chrome = chromeApi();
    const tabs = await chrome.tabs.query({});
    const available = tabs.filter(tab => {
      if (owned.has(tab.id)) return false;
      try {
        const u = new URL(tab.url);
        return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
          (originOnly ? u.origin === YUANBAO : withoutHash(tab.url) === pageUrl) &&
          (!tab.pendingUrl || withoutHash(tab.pendingUrl) === withoutHash(tab.url));
      } catch (_) { return false; }
    }).sort((a, b) => (b.id === preferredTabId) - (a.id === preferredTabId));
    if (available.length) return { id: available[0].id, expected: withoutHash(available[0].url), own: false };
    const key = pageUrl;
    let record = Array.from(owned.values()).find(r => r.expected === pageUrl && !r.adopted && !r.disposing);
    if (!record) {
      let operation = creating.get(key);
      if (!operation) {
        operation = (async () => {
          const hash = marker(pageUrl);
          const tab = await chrome.tabs.create({ url: pageUrl + hash, active: false });
          const created = { id: tab.id, expected: pageUrl, hash, own: true, refs: 0, adopted: false };
          owned.set(tab.id, created);
          return created;
        })();
        creating.set(key, operation);
        operation.finally(() => creating.delete(key)).catch(() => {});
      }
      record = await operation;
    }
    record.refs++;
    return record;
  }
  async function request(pageUrl, endpoint, body, preferredTabId, originOnly = false) {
    const record = await acquire(pageUrl, preferredTabId, originOnly);
    try {
      await waitForTab(record);
      const before = await chromeApi().tabs.get(record.id);
      if (!exact(before, record.expected)) throw error('解析页面发生了跳转，请重新解析。', 'navigation');
      const results = await withTimeout(chromeApi().scripting.executeScript({ target: { tabId: record.id }, world: 'MAIN',
        func: requestInPage, args: [record.expected, endpoint, body, REQUEST_MS] }), SCRIPT_MS,
        error('视频号解析超时，请重试。', 'timeout'));
      const after = await chromeApi().tabs.get(record.id);
      if (!exact(after, record.expected)) throw error('解析页面发生了跳转，已丢弃本次结果。', 'navigation');
      const result = results?.find(item => item.frameId === 0)?.result || results?.[0]?.result;
      if (!result?.ok) {
        if (result?.kind === 'http') {
          if (endpoint.startsWith(PARSE_API) && result.status === 401) throw authError();
          if (endpoint.startsWith(FEED_API) && (result.status === 401 || result.status === 403)) throw error('视频号播放凭证已失效，请粘贴最新分享链接重新解析。', 'expired', { status: result.status });
          throw error('腾讯接口暂时读取失败（HTTP ' + result.status + '），请稍后重试。', 'http', { status: result.status });
        }
        if (result?.kind === 'navigation') throw error('腾讯接口或解析页面发生了跳转，请重新解析。', 'navigation');
        if (result?.kind === 'timeout') throw error('视频号解析超时，请重试。', 'timeout');
        if (result?.kind === 'oversize') throw error('腾讯接口响应过大，已停止解析。', 'invalid');
        if (result?.kind === 'invalid') throw error('腾讯接口没有返回有效的视频信息，请稍后重试。', 'invalid');
        if (result?.kind === 'page-init') throw error('腾讯元宝网页尚未初始化，请在 Chrome 内打开腾讯元宝后重试。', 'page-init', { loginUrl: LOGIN_URL });
        throw error('暂时无法连接腾讯接口，请检查 Chrome 的网络后重试。', 'network');
      }
      return result.payload;
    } finally { if (record.own) { record.refs--; await dispose(record); } }
  }
  function playable(payload) {
    if (authPayload(payload)) throw authError();
    if (!payload || typeof payload.code !== 'number') throw error('腾讯元宝没有返回有效的解析结果，请稍后重试。', 'invalid');
    if (payload.code !== 0) throw error('腾讯元宝暂时无法解析这条链接（错误码 ' + payload.code + '），请稍后重试。', 'platform');
    let target;
    try {
      target = C().parsePage(payload.data?.playable_url);
      const u = new URL(target.pageUrl);
      if (u.origin !== CHANNELS || u.pathname !== '/finder-preview/pages/feed' || !target.exportId || !target.token) throw new Error('incomplete');
    } catch (_) { throw error('腾讯元宝返回的播放页不完整或不是官方视频号页面，请重新解析。', 'invalid'); }
    return target;
  }
  async function doResolve(info, preferredTabId) {
    let target = info;
    try {
      if (!info.token && info.shareUrl) {
        try {
          const parsed = await request(LOGIN_URL, PARSE_API, { type: 'video_channel_url', url: info.shareUrl, scene: 1 }, preferredTabId, true);
          target = playable(parsed); authenticated = true; checkedAt = Date.now();
        } catch (problem) {
          if (problem.needsLogin) { authenticated = false; checkedAt = Date.now(); }
          throw problem;
        }
      }
      const endpoint = new URL(FEED_API);
      const referrer = new URL(target.pageUrl); referrer.search = ''; referrer.hash = '';
      endpoint.searchParams.set('_pageUrl', referrer.href);
      endpoint.searchParams.set('_rid', Math.floor(Date.now() / 1000).toString());
      const body = { baseReq: { generalToken: target.token || '' }, ...(target.shortUri ? { shortUri: target.shortUri } : { exportId: target.exportId }) };
      const payload = await request(target.pageUrl, endpoint.href, body, preferredTabId);
      if (expiredPayload(payload)) throw error('视频号播放凭证已失效，请粘贴最新分享链接重新解析。', 'expired');
      const result = C().extractFeed(payload, target);
      return { ...result, shareUrl: info.shareUrl || target.shareUrl || '', method: 'channels-browser', browserOnly: true,
        ...(!result.candidates?.length ? { reasonCode: result.metadataOnly ? 'cover-only' : result.protected ? 'protected' : 'platform', requiresPage: false } : {}) };
    } catch (problem) {
      return failure(problem.reasonCode ? problem.message : '浏览器解析暂时失败，请重试。', info,
        { reasonCode: problem.reasonCode || 'browser', browserOnly: true, requiresPage: false,
          ...(problem.status ? { status: problem.status } : {}), ...(problem.loginUrl ? { loginUrl: LOGIN_URL } : {}),
          ...(problem.needsLogin ? { needsLogin: true, loginUrl: LOGIN_URL } : {}) });
    }
  }
  async function resolve(pageUrl, preferredTabId) {
    let info;
    try { info = C().parsePage(pageUrl); } catch (problem) { return failure(problem.message, {}, { reasonCode: 'invalid', requiresPage: false }); }
    const key = info.pageUrl;
    if (resolving.has(key)) return resolving.get(key);
    const operation = doResolve(info, preferredTabId);
    resolving.set(key, operation);
    try { return await operation; } finally { resolving.delete(key); }
  }
  async function openLogin() {
    if (loginOpening) return loginOpening;
    loginOpening = (async () => {
      await ready();
      const chrome = chromeApi();
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(item => {
        try { return new URL(item.url).origin === YUANBAO && !owned.has(item.id); } catch (_) { return false; }
      });
      const opened = tab ? await chrome.tabs.update(tab.id, { active: true }) : await chrome.tabs.create({ url: LOGIN_URL, active: true });
      return { opened: true, tabId: opened.id, loginUrl: LOGIN_URL };
    })();
    try { return await loginOpening; } finally { loginOpening = null; }
  }
  async function status() {
    await ready();
    return { available: !!chromeApi()?.scripting && !!chromeApi()?.tabs, browserOnly: true, mode: 'browser',
      authenticated, authenticationMeaning: 'parse-session', sessionValidated: authenticated === true,
      needsLogin: authenticated === false, verified: authenticated !== null, checkedAt, loginUrl: LOGIN_URL,
      message: authenticated === false ? '上一次解析需要登录，请在 Chrome 内完成腾讯元宝登录后重新解析。' :
        authenticated === true ? '上一次腾讯网页解析会话可用，可以在插件中继续预览与下载。' :
        '浏览器解析模式已就绪，是否登录以实际解析结果为准。' };
  }
  return { resolve, openLogin, status };
});
