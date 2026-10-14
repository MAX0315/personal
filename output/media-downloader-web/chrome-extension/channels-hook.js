/* Observe only the official response for the video currently shown on this page. */
(() => {
  'use strict';
  const C = globalThis.ChannelsExtractor;
  const VERSION = '1.8.2';
  if (!C || !C.isChannelsUrl(location.href) || globalThis.__vodExtractChannelsCurrent?.vodVersion === VERSION) return;
  const MAX_BYTES = 4 * 1024 * 1024;
  const TTL = 15 * 60 * 1000;
  let captured = null;
  function identity(info) { return info?.shortUri ? 's:' + info.shortUri : info?.exportId ? 'e:' + info.exportId : ''; }
  function requestInfo(url, body) {
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== 'https://channels.weixin.qq.com' || parsed.pathname !== '/finder-preview/api/feed/get_feed_info') return null;
      const info = C.parsePage(location.href);
      if (!info) return null;
      let payload = body;
      if (typeof payload === 'string' && payload.length < 65536) payload = JSON.parse(payload);
      if (!payload || typeof payload !== 'object') return null;
      if (!(info.shortUri && payload.shortUri === info.shortUri || info.exportId && payload.exportId === info.exportId)) return null;
      return info;
    } catch (_) { return null; }
  }
  function store(payload, info) {
    if (identity(C.parsePage(location.href)) !== identity(info)) return;
    const result = C.extractFeed(payload, info);
    captured = { key: identity(info), created: Date.now(), candidates: result.candidates || [] };
  }
  async function responseJson(response) {
    if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body?.getReader) return null;
    const reader = response.body.getReader();
    const parts = [], decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) return null;
        parts.push(decoder.decode(value, { stream: true }));
      }
      parts.push(decoder.decode());
      return JSON.parse(parts.join(''));
    } catch (_) { return null; }
    finally { void reader.cancel().catch(() => {}); }
  }
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === 'function') {
    globalThis.fetch = function (...args) {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url;
      const info = requestInfo(url, args[1]?.body);
      const pending = originalFetch.apply(this, args);
      if (info) pending.then(response => {
        if (!response.ok) return;
        void responseJson(response.clone()).then(payload => { if (payload) store(payload, info); }).catch(() => {});
      }).catch(() => {});
      return pending;
    };
  }
  const XHR = globalThis.XMLHttpRequest;
  if (XHR?.prototype) {
    const originalOpen = XHR.prototype.open, originalSend = XHR.prototype.send;
    const urls = new WeakMap();
    XHR.prototype.open = function (method, url, ...args) {
      urls.set(this, String(url));
      return originalOpen.call(this, method, url, ...args);
    };
    XHR.prototype.send = function (body) {
      const info = requestInfo(urls.get(this), body);
      if (info) this.addEventListener('load', () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          if (this.responseType === 'json') {
            if (JSON.stringify(this.response).length <= MAX_BYTES) store(this.response, info);
          } else if (!this.responseType || this.responseType === 'text') {
            if (this.responseText.length <= MAX_BYTES) store(JSON.parse(this.responseText), info);
          }
        } catch (_) {}
      }, { once: true });
      return originalSend.call(this, body);
    };
  }
  const extractCurrent = () => {
    const current = C.parsePage(location.href);
    if (!captured || Date.now() - captured.created > TTL || captured.key !== identity(current)) return [];
    return captured.candidates.map(item => ({ ...item }));
  };
  extractCurrent.vodVersion = VERSION;
  globalThis.__vodExtractChannelsCurrent = extractCurrent;
})();
