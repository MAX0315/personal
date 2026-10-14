/* Runs in Douyin's MAIN world. Only metadata for the matching work leaves this script. */
(function () {
  'use strict';
  if (!globalThis.VideoExtractor || !VideoExtractor.isDouyinUrl(location.href)) return;
  if (globalThis.__vodExtractCurrent?.vodVersion === '1.2.2') return;
  const api = globalThis.VideoExtractor;
  const cache = new Map();
  const pending = new Set();
  const detailAttempts = new Map();
  let requestedId = '';
  const MAX_RESPONSE = 8 * 1024 * 1024;
  const originalFetch = globalThis.fetch;
  function currentId() { return api.getDouyinId(location.href) || requestedId; }
  function freshItems(id) {
    const entry = cache.get(id);
    if (!entry || Date.now() - entry.at > 20 * 60 * 1000) { cache.delete(id); return []; }
    return entry.items;
  }
  async function readResponse(response) {
    if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_RESPONSE) return null;
    const type = response.headers.get('content-type') || '';
    if (type && !/json|text/.test(type)) return null;
    if (!response.body?.getReader) {
      const text = await response.text();
      return text.length <= MAX_RESPONSE ? api.parseJson(text) : null;
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let total = 0, text = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE) { reader.cancel().catch(() => {}); return null; }
        text += decoder.decode(value, { stream: true });
      }
      return api.parseJson(text + decoder.decode());
    } finally { reader.releaseLock(); }
  }
  function remember(data) {
    const id = currentId();
    if (!id || !data) return;
    const items = api.extractDouyin(data, id);
    if (!items.length) return;
    cache.set(id, { at: Date.now(), items: api.rankCandidates([...(cache.get(id)?.items || []), ...items]).slice(0, 80) });
    for (const [key, entry] of cache) if (Date.now() - entry.at > 20 * 60 * 1000 || cache.size > 8) cache.delete(key);
  }
  function relevantUrl(value) {
    try {
      const url = new URL(value, location.href);
      return api.isDouyinUrl(url.href) && /\/aweme\/v\d+\/(?:web\/)?(?:aweme\/(?:detail|feed|post|related)|feed|familiar|mix\/aweme|series\/aweme)/i.test(url.pathname);
    } catch (_) { return false; }
  }
  function watch(promise) {
    pending.add(promise);
    promise.finally(() => pending.delete(promise)).catch(() => {});
  }
  if (typeof originalFetch === 'function') {
    globalThis.fetch = function (...args) {
      const responsePromise = Reflect.apply(originalFetch, this, args);
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : input?.url;
        if (relevantUrl(url) && pending.size < 12) watch(responsePromise.then(async response => {
          remember(await readResponse(response.clone()));
        }).catch(() => {}));
      } catch (_) {}
      return responsePromise;
    };
  }
  const xhrProto = globalThis.XMLHttpRequest?.prototype;
  if (xhrProto) {
    const open = xhrProto.open, send = xhrProto.send, tracked = new WeakMap();
    xhrProto.open = function (method, url, ...args) {
      tracked.set(this, relevantUrl(String(url)));
      return Reflect.apply(open, this, [method, url, ...args]);
    };
    xhrProto.send = function (...args) {
      if (tracked.get(this)) this.addEventListener('load', () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          if (this.responseType === 'json') remember(this.response);
          else if (!this.responseType || this.responseType === 'text') {
            const text = this.responseText;
            if (text.length <= MAX_RESPONSE) remember(api.parseJson(text));
          }
        } catch (_) {}
      }, { once: true });
      return Reflect.apply(send, this, args);
    };
  }
  function readState() {
    for (const key of ['_ROUTER_DATA', '__INITIAL_STATE__', '__NEXT_DATA__', '__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE', '__SSR_DATA__']) {
      try { remember(Object.getOwnPropertyDescriptor(globalThis, key)?.value); } catch (_) {}
    }
    // Inspect JSON scripts only. Never execute inline code or collect arbitrary DOM text.
    const scripts = Array.from(document.scripts).slice(0, 400);
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text || text.length > MAX_RESPONSE) continue;
      if (/application\/(?:ld\+)?json/i.test(script.type) || /^(?:RENDER_DATA|__NEXT_DATA__|__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE)$/.test(script.id)) {
        let decoded = text;
        if (script.id === 'RENDER_DATA') { try { decoded = decodeURIComponent(text); } catch (_) {} }
        remember(api.parseJson(decoded));
      } else if (/_ROUTER_DATA|__INITIAL_STATE__|SIGI_STATE|__SSR_DATA__/.test(text)) {
        const items = api.extractFromHtml('<script>' + text + '</script>', currentId());
        if (items.length) cache.set(currentId(), { at: Date.now(), items: api.rankCandidates([...(cache.get(currentId())?.items || []), ...items]).slice(0, 80) });
      }
    }
  }
  function readMediaProps() {
    // Lazy-loaded detail pages often retain aweme metadata in media React props.
    // Limit this to video/image ancestors and their data props; do not traverse the full tree.
    const elements = new Set();
    for (const media of Array.from(document.querySelectorAll('video, img')).slice(0, 40)) {
      let element = media;
      for (let level = 0; element && level < 12; level++, element = element.parentElement) elements.add(element);
    }
    const roots = [], fibers = new WeakSet();
    for (const element of elements) {
      for (const key of Object.getOwnPropertyNames(element)) {
        if (!/^__reactProps\$|^__reactFiber\$/.test(key)) continue;
        try {
          const value = Object.getOwnPropertyDescriptor(element, key)?.value;
          if (key.startsWith('__reactProps$')) roots.push(value);
          else {
            let fiber = value;
            for (let level = 0; fiber && typeof fiber === 'object' && level < 14 && !fibers.has(fiber); level++) {
              fibers.add(fiber);
              roots.push(Object.getOwnPropertyDescriptor(fiber, 'memoizedProps')?.value);
              roots.push(Object.getOwnPropertyDescriptor(fiber, 'pendingProps')?.value);
              roots.push(Object.getOwnPropertyDescriptor(fiber, 'memoizedState')?.value);
              fiber = Object.getOwnPropertyDescriptor(fiber, 'return')?.value;
            }
          }
        } catch (_) {}
      }
    }
    remember(roots);
  }
  function rememberDomImages(id) {
    if (!id || typeof api.fullImageUrl !== 'function') return;
    // A video page's poster/recommendation images are not the requested media.
    // Only an explicit image-note route may use the gallery fallback.
    if (api.getDouyinId(location.href) !== id || !/\/(?:note|share\/(?:note|slides))\//i.test(new URL(location.href).pathname)) return;
    const images = [];
    for (const element of Array.from(document.images || []).slice(0, 120)) {
      try {
        const raw = element.currentSrc || element.src || element.getAttribute('data-src') || element.getAttribute('data-original');
        const url = api.fullImageUrl(raw);
        if (!url) continue;
        const parsed = new URL(url);
        if (!/(?:douyin|byteimg|ibytedtos|bytedance|pstatp|snssdk|tiktokcdn)/i.test(parsed.hostname + parsed.pathname)) continue;
        const rect = element.getBoundingClientRect();
        const width = Number(element.naturalWidth || element.width || 0), height = Number(element.naturalHeight || element.height || 0);
        if (width < 160 || height < 160 || rect.width < 80 || rect.height < 80 || rect.bottom <= 0 || rect.top >= innerHeight) continue;
        if (images.some(item => item.url_list?.includes(url))) continue;
        images.push({ width, height, url_list: [url] });
      } catch (_) {}
    }
    if (images.length) remember({ aweme_id: id, desc: document.title || '抖音图文', image_post_info: { images } });
  }
  async function extractCurrent(targetId) {
    if (!/^\d{8,24}$/.test(String(targetId || ''))) return [];
    const wanted = String(targetId);
    const pageId = api.getDouyinId(location.href);
    if (pageId && pageId !== wanted) return [];
    requestedId = wanted;
    readState();
    readMediaProps();
    if (!freshItems(wanted).length) rememberDomImages(wanted);
    if (pending.size) await Promise.race([Promise.allSettled(Array.from(pending)), new Promise(resolve => setTimeout(resolve, 1200))]);
    let items = freshItems(wanted);
    // Use the same-origin public detail endpoint in the user's normal browser session.
    // No token collection/signature bypass; if the platform rejects it, leave no false result.
    if (!items.length && typeof originalFetch === 'function' && Date.now() - (detailAttempts.get(wanted) || 0) > 10000) {
      detailAttempts.set(wanted, Date.now());
      if (detailAttempts.size > 8) detailAttempts.delete(detailAttempts.keys().next().value);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      try {
        const url = new URL('/aweme/v1/web/aweme/detail/', location.origin);
        url.searchParams.set('device_platform', 'webapp');
        url.searchParams.set('aid', '6383');
        url.searchParams.set('aweme_id', wanted);
        const response = await originalFetch(url.href, { credentials: 'same-origin', signal: controller.signal });
        remember(await readResponse(response));
      } catch (_) {} finally { clearTimeout(timer); }
      readMediaProps();
      if (!freshItems(wanted).length) rememberDomImages(wanted);
      items = freshItems(wanted);
    }
    const afterId = api.getDouyinId(location.href);
    if (afterId && afterId !== wanted) return [];
    return items.filter(item => item.videoId === wanted).map(item => ({ ...item }));
  }
  extractCurrent.vodVersion = '1.2.2';
  globalThis.__vodExtractCurrent = extractCurrent;
})();
