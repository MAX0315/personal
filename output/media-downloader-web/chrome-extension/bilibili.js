/* Bilibili page and progressive MP4 stream extraction. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BiliExtractor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_TEXT = 12 * 1024 * 1024;

  function normalizeUrl(value, base = 'https://www.bilibili.com/') {
    if (typeof value !== 'string') return '';
    let text = value.trim().replace(/&amp;|&#38;/g, '&').replace(/\\u002[fF]/g, '/').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    if (text.startsWith('//')) text = 'https:' + text;
    if (/^(?:blob|data|javascript):/i.test(text)) return '';
    try {
      const url = new URL(text, base);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }

  function isBilibiliUrl(value) {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'b23.tv' || host.endsWith('.b23.tv') || host === 'bili2233.cn' || host.endsWith('.bili2233.cn');
    } catch (_) { return false; }
  }

  function getBvid(value) {
    try {
      const url = new URL(value);
      const match = url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i) || url.search.match(/(?:^|[?&])bvid=(BV[0-9A-Za-z]+)/i);
      const bvid = match?.[1] || '';
      return /^BV[0-9A-Za-z]{10}$/i.test(bvid) ? bvid : '';
    } catch (_) { return ''; }
  }

  function getAid(value) {
    try {
      const url = new URL(value);
      const match = url.pathname.match(/\/(?:video\/)?av(\d+)/i) || url.search.match(/(?:^|[?&])aid=(\d+)/i);
      return match?.[1] || '';
    } catch (_) { return ''; }
  }

  function getPage(value) {
    try { return Math.max(1, Number(new URL(value).searchParams.get('p') || 1) || 1); } catch (_) { return 1; }
  }

  function decodeHtml(text) {
    return String(text || '').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
  }

  function attrs(text) {
    const out = Object.create(null);
    const re = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let match;
    while ((match = re.exec(String(text || '').slice(0, 16000)))) out[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
    return out;
  }

  function balanced(text, offset) {
    let start = offset;
    while (start < text.length && /\s/.test(text[start])) start++;
    if (!/[{[]/.test(text[start] || '')) return '';
    let quoted = false, escaped = false, depth = 0;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
      if (c === '"') quoted = true;
      else if (c === '[' || c === '{') depth++;
      else if ((c === ']' || c === '}') && --depth === 0) return text.slice(start, i + 1);
    }
    return '';
  }

  function parseJson(text) {
    if (typeof text !== 'string' || text.length > MAX_TEXT) return null;
    try { return JSON.parse(text); } catch (_) {}
    // Bilibili's embedded state contains large numeric IDs; quoting them avoids precision loss.
    let out = '', quoted = false, escaped = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) { out += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
      if (c === '"') { quoted = true; out += c; continue; }
      if (c === '-' || /\d/.test(c)) {
        const m = text.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (m) { const token = m[0]; out += /^-?\d{16,}$/.test(token) ? JSON.stringify(token) : token; i += token.length - 1; continue; }
      }
      out += c;
    }
    try { return JSON.parse(out); } catch (_) { return null; }
  }

  function embeddedObjects(html) {
    const out = [];
    if (typeof html !== 'string' || html.length > MAX_TEXT) return out;
    const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let match, count = 0;
    while ((match = scripts.exec(html)) && count++ < 500) {
      const a = attrs(match[1]);
      const body = match[2].trim();
      if (!body || a.src) continue;
      if (/application\/(?:ld\+)?json/i.test(a.type) || /^(?:INITIAL_STATE|NEXT_DATA|PLAYINFO|__INITIAL_STATE__|__playinfo__)$/.test(a.id || '') || /^[{[]/.test(body)) {
        const parsed = parseJson(body);
        if (parsed) out.push(parsed);
      }
      const assignments = /(?:window\s*\.\s*)?(?:__playinfo__|__INITIAL_STATE__|_INITIAL_STATE|__NEXT_DATA__)\s*=\s*/g;
      let item;
      while ((item = assignments.exec(body))) {
        const parsed = parseJson(balanced(body, assignments.lastIndex));
        if (parsed) out.push(parsed);
      }
    }
    return out;
  }

  function meta(html, name) {
    const re = /<meta\b([^>]*)>/gi;
    let match;
    while ((match = re.exec(html || ''))) {
      const a = attrs(match[1]);
      if (String(a.property || a.name || '').toLowerCase() === name.toLowerCase()) return a.content || '';
    }
    return '';
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function walk(value, visit, depth = 0, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || depth > 14 || seen.has(value)) return;
    seen.add(value);
    visit(value, depth);
    for (const child of Object.values(value).slice(0, 500)) walk(child, visit, depth + 1, seen);
  }

  function findFirst(root, keys) {
    let answer = '';
    walk(root, object => {
      if (answer) return;
      for (const key of keys) if (object[key] !== undefined && object[key] !== null && object[key] !== '') { answer = object[key]; break; }
    });
    return answer;
  }

  function infoFromHtml(html, pageUrl) {
    const objects = embeddedObjects(html);
    const pageBvid = getBvid(pageUrl);
    const bvid = pageBvid || String(findFirst(objects, ['bvid']) || '').match(/BV[0-9A-Za-z]{10}/i)?.[0] || '';
    const pageAid = getAid(pageUrl);
    let stateAid = '';
    walk(objects, object => {
      if (!stateAid && bvid && String(object.bvid || '').toLowerCase() === bvid.toLowerCase() && /^\d+$/.test(String(object.aid || ''))) stateAid = String(object.aid);
    });
    const aid = pageAid || stateAid;
    const title = decodeHtml(meta(html, 'og:title') || (/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html || '')?.[1] || '')).replace(/_哔哩哔哩.*$/i, '').trim() || '哔哩哔哩视频';
    const page = getPage(pageUrl);
    let cid = '';
    const pages = [];
    let duration = number(meta(html, 'video:duration'));
    for (const data of objects) walk(data, object => {
      if (!cid && (object.cid !== undefined || object.CID !== undefined)) cid = String(object.cid ?? object.CID);
      if (object.dash && number(object.dash.duration) > 0) duration = number(object.dash.duration);
      if ((object.durl || object.dash) && number(object.duration) > 0) duration = number(object.duration);
      if ((object.durl || object.dash) && number(object.timelength) > 0) duration = number(object.timelength) / 1000;
      const list = object.pages;
      if (Array.isArray(list)) for (const item of list.slice(0, 100)) if (item && typeof item === 'object') pages.push(item);
    });
    const selected = pages.find(item => Number(item.page || item.p) === page) || pages[0];
    if (selected?.cid) cid = String(selected.cid);
    if (!cid) cid = String(findFirst(objects, ['cid']) || '');
    const candidates = [];
    const seen = new Set();
    function add(item, index, source) {
      const url = normalizeUrl(item?.url || item?.baseUrl || item?.base_url, pageUrl);
      if (!url || seen.has(url)) return;
      const path = new URL(url).pathname;
      if (!/\.mp4$/i.test(path)) return;
      seen.add(url);
      candidates.push({ videoUrl: url, kind: 'video', source, sourceRole: 'native-playback', platform: 'bilibili', videoId: bvid || aid, title, duration: number(item?.length) > 0 ? number(item.length) / 1000 : duration, width: number(item?.width), height: number(item?.height), fileName: title.slice(0, 100) + '.mp4', quality: item?.quality || item?.id || 0, _index: index });
    }
    for (const data of objects) walk(data, object => {
      const durl = object.durl;
      // Multiple durl entries are sequential fragments, not independent files.
      if (Array.isArray(durl) && durl.length === 1) add(durl[0], 0, 'BILIBILI.playinfo.durl');
    });
    return { bvid, aid, cid, page, title, duration, candidates, hasDash: objects.some(data => { let found = false; walk(data, object => { if (object.dash?.video || object.video?.[0]?.baseUrl) found = true; }); return found; }) };
  }

  function buildPlayUrl(info, quality = 80) {
    if (!info?.cid || (!info.bvid && !info.aid)) return '';
    const url = new URL('https://api.bilibili.com/x/player/playurl');
    if (info.bvid) url.searchParams.set('bvid', info.bvid); else url.searchParams.set('avid', info.aid);
    url.searchParams.set('cid', info.cid);
    url.searchParams.set('qn', String(quality));
    url.searchParams.set('fnval', '1');
    url.searchParams.set('fnver', '0');
    url.searchParams.set('fourk', '1');
    url.searchParams.set('platform', 'html5');
    url.searchParams.set('high_quality', '1');
    return url.href;
  }

  function candidatesFromApi(payload, info) {
    const data = payload?.data;
    if (!data || !Array.isArray(data.durl) || data.durl.length !== 1) return [];
    const item = data.durl[0];
    const url = normalizeUrl(item?.url || item?.backup_url?.[0] || item?.backupUrl?.[0]);
    if (!url || !/\.mp4(?:$|\?)/i.test(url)) return [];
    return [{ videoUrl: url, kind: 'video', source: 'BILIBILI.playurl.mp4', sourceRole: 'native-playback', platform: 'bilibili', videoId: info.bvid || info.aid, title: info.title, duration: number(data.timelength) / 1000 || info.duration, width: number(data.width), height: number(data.height), fileName: info.title.slice(0, 100) + '.mp4', quality: data.quality || 0 }];
  }

  return { normalizeUrl, isBilibiliUrl, getBvid, getAid, getPage, parseJson, embeddedObjects, infoFromHtml, buildPlayUrl, candidatesFromApi };
});
