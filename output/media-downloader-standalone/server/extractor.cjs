/* Shared, dependency-free Douyin extraction. No generic URL fallback is used here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VideoExtractor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_NODES = 30000;
  const MAX_TEXT = 12 * 1024 * 1024;
  const ID_KEYS = ['aweme_id', 'awemeId', 'item_id', 'itemId', 'group_id', 'groupId'];
  const PLAY_KEYS = new Set(['play_addr', 'playAddr', 'play_addr_h264', 'playAddrH264', 'play_addr_265', 'playAddr265', 'play_addr_bytevc1', 'playAddrBytevc1', 'play_api', 'playApi', 'play_url', 'playUrl', 'download_addr', 'downloadAddr']);
  const VARIANT_KEYS = new Set(['bit_rate', 'bitRate', 'bitrateList', 'bitRateList', 'qualityList', 'gearList']);
  const IMAGE_CONTAINER_KEYS = new Set(['images', 'image_list', 'imageList', 'image_infos', 'imageInfos', 'image_post_info', 'imagePostInfo', 'note_info', 'noteInfo']);
  const IMAGE_URL_KEYS = ['url_list', 'urlList', 'download_url_list', 'downloadUrlList', 'origin_url', 'originUrl', 'image_url', 'imageUrl', 'url', 'src'];

  function normalizeUrl(value, base = 'https://www.douyin.com/') {
    if (typeof value !== 'string') return '';
    let text = value.trim().replace(/&amp;|&#38;/g, '&').replace(/\\u002[fF]/g, '/').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    if (text.startsWith('//')) text = 'https:' + text;
    if (/^(?:blob|data|javascript):/i.test(text)) return '';
    try {
      const url = new URL(text, base);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }
  function isDouyinUrl(value) {
    try { const h = new URL(value).hostname.toLowerCase(); return h === 'douyin.com' || h.endsWith('.douyin.com') || h === 'iesdouyin.com' || h.endsWith('.iesdouyin.com'); } catch (_) { return false; }
  }
  function idString(value) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
    const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    return /^\d{8,24}$/.test(text) ? text : '';
  }
  function getDouyinId(value) {
    try {
      const url = new URL(value);
      if (!isDouyinUrl(url.href)) return '';
      // A modal may show a different item while the pathname remains unchanged.
      for (const name of ['modal_id', 'aweme_id', 'item_id', 'vid']) {
        const id = idString(url.searchParams.get(name));
        if (id) return id;
      }
      return idString(url.pathname.match(/\/(?:video|note|share\/(?:video|note|slides))\/(\d+)/i)?.[1]);
    } catch (_) { return ''; }
  }
  function parseJson(value) {
    if (typeof value !== 'string' || value.length > MAX_TEXT) return null;
    // JSON.parse otherwise rounds 19-digit aweme IDs before they can be compared.
    // Scan tokens rather than regex-replacing inside quoted strings.
    let out = '', inString = false, escaped = false;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (inString) {
        out += ch;
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; out += ch; continue; }
      if (ch === '-' || /\d/.test(ch)) {
        const m = value.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (m) {
          const token = m[0];
          out += /^-?\d{16,}$/.test(token) ? JSON.stringify(token) : token;
          i += token.length - 1;
          continue;
        }
      }
      out += ch;
    }
    try { return JSON.parse(out); } catch (_) { return null; }
  }
  function get(obj, key) {
    if (!obj || typeof obj !== 'object') return undefined;
    try { return Object.getOwnPropertyDescriptor(obj, key)?.value; } catch (_) { return undefined; }
  }
  function first(obj, keys) {
    for (const key of keys) { const value = get(obj, key); if (value !== undefined && value !== null && value !== '') return value; }
    return undefined;
  }
  function number(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
  function mediaDuration(video, item) {
    // Native Douyin duration fields use milliseconds, including clips shorter than 1s.
    const seconds = number(first(video, ['duration_seconds', 'durationSeconds']) || first(item, ['duration_seconds', 'durationSeconds']));
    return seconds || number(first(video, ['duration', 'duration_ms', 'durationMs']) || first(item, ['duration', 'duration_ms', 'durationMs'])) / 1000;
  }
  function codec(obj, inherited = '') {
    const raw = String(first(obj, ['codec', 'codec_type', 'codecType', 'video_codec', 'videoCodec']) || '').toLowerCase();
    if (/hevc|h265|h\.265|bytevc1/.test(raw) || number(first(obj, ['is_h265', 'isH265'])) === 1) return 'h265';
    if (/avc|h264|h\.264/.test(raw)) return 'h264';
    return inherited;
  }
  function unsafeFormat(obj) {
    const format = String(first(obj, ['format', 'file_format', 'fileFormat', 'mime_type', 'mimeType', 'media_type']) || '');
    return /dash|mpegurl|m3u8|audio|segment/i.test(format);
  }
  function fullVideoUrl(value) {
    const url = normalizeUrl(value);
    if (!url || !/^https?:\/\//i.test(String(value).replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/')) && !/^\/\//.test(value) && !/^\/aweme\/v\d+\/play\//.test(value)) return '';
    let parsed;
    try { parsed = new URL(url); } catch (_) { return ''; }
    const path = parsed.pathname.toLowerCase();
    if (/douyin[_-]?pc[_-]?client|(?:^|[\/_-])(?:client_promo|download_banner|promotion|advertisement)(?:[\/_\-.]|$)/i.test(path)) return '';
    if (/\.(?:m3u8|mpd|m4s|ts|aac|mp3|jpg|jpeg|png|webp|gif)(?:$|\/)/i.test(path)) return '';
    if (/\/(?:dash|segment|segments|chunk|chunks)\//i.test(path)) return '';
    if (/dash|mpegurl|audio/i.test(parsed.searchParams.get('mime_type') || parsed.searchParams.get('format') || '')) return '';
    for (const key of parsed.searchParams.keys()) if (/^(?:range|byte_?start|byte_?end|start|end|segment|segment_index|chunk|chunk_index|part)$/i.test(key)) return '';
    // A URL must still look like a video resource, even within a matching item.
    if (!/\.mp4$|\.mov$|\.webm$|\/video\/|\/aweme\/v\d+\/(?:play|playwm)\/?$/i.test(path) && !/douyinvod\.com$|bytecdn\.cn$|ibytedtos\.com$|bytevcloud\.com$/i.test(parsed.hostname) && !/video[_/]?mp4/i.test(parsed.searchParams.get('mime_type') || '')) return '';
    return url;
  }
  function fullImageUrl(value) {
    const url = normalizeUrl(value);
    if (!url) return '';
    let parsed;
    try { parsed = new URL(url); } catch (_) { return ''; }
    const path = parsed.pathname.toLowerCase();
    const all = (path + ' ' + parsed.search).toLowerCase();
    if (/(?:\.mp4|\.mov|\.webm|\.m4v|\.m3u8|\.mpd|\.m4s|\.ts|\.aac|\.mp3)(?:$|[/?#])/i.test(path)) return '';
    if (/\/video\/|\/aweme\/v\d+\/play(?:wm)?\//i.test(path) || /(?:mime_type|format)=?(?:video|audio|mpegurl|dash)/i.test(all)) return '';
    if (/douyin[_-]?pc[_-]?client|(?:^|[\/_-])(?:client_promo|download_banner|promotion|advertisement)(?:[\/_\-.]|$)/i.test(path)) return '';
    // Image URLs sometimes have no extension and are only identified by their CDN.
    // This function is called only for explicit image fields, so retain signed URLs.
    return url;
  }
  function filename(title, id) {
    const clean = String(title || '抖音视频').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 70) || '抖音视频';
    return clean + '_' + id + '.mp4';
  }
  function imageFilename(title, id, index, url, format = '') {
    const clean = String(title || '抖音图文').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 70) || '抖音图文';
    let ext = String(format || '').toLowerCase().match(/(?:image\/)?(jpeg|jpg|png|webp|gif|avif|heic|heif)/)?.[1] || '';
    if (ext === 'jpeg') ext = 'jpg';
    if (!ext) {
      try { ext = new URL(url).pathname.match(/\.(jpeg|jpg|png|webp|gif|avif|heic|heif)$/i)?.[1]?.toLowerCase() || ''; } catch (_) {}
    }
    if (!ext) ext = 'jpg';
    return clean + '_' + id + '_图' + String(Number(index || 0) + 1).padStart(2, '0') + '.' + ext;
  }
  function rankCandidates(items) {
    const seen = new Map();
    for (const item of items || []) {
      if (!item?.videoUrl) continue;
      const old = seen.get(item.videoUrl);
      if (!old || score(item) > score(old)) seen.set(item.videoUrl, item);
    }
    return Array.from(seen.values()).sort((a, b) => {
      const kindRank = item => item.kind === 'video' ? 0 : item.kind === 'image' ? 1 : 2;
      const kindDiff = kindRank(a) - kindRank(b);
      if (kindDiff) return kindDiff;
      if (a.kind === 'image' && b.kind === 'image') return (Number(a.imageIndex) || 0) - (Number(b.imageIndex) || 0) || score(b) - score(a);
      return score(b) - score(a);
    });
  }
  function score(c) {
    if (c.kind === 'image') return 2e18 - (Number(c.imageIndex) || 0) * 1e12 + (c.width || 0) * (c.height || 0);
    // A full progressive play URL is preferred over the download/watermark fallback.
    const source = c.source || '';
    return (source.includes('download') ? 0 : 4e15) + (c.codec === 'h264' ? 2e15 : c.codec === 'h265' ? 0 : 1e15) + (c.width || 0) * (c.height || 0) * 1e5 + (c.bitrate || 0);
  }
  function extractDouyin(input, targetId) {
    const wanted = idString(targetId);
    if (!wanted || !input || typeof input !== 'object') return [];
    const output = [], seen = new WeakSet(), queue = [{ value: input, depth: 0 }];
    let visited = 0;
    while (queue.length && visited++ < MAX_NODES) {
      const { value: obj, depth } = queue.pop();
      if (!obj || typeof obj !== 'object' || seen.has(obj) || depth > 22) continue;
      seen.add(obj);
      const primaryId = first(obj, ID_KEYS);
      const matchId = idString(primaryId) || (get(obj, 'video') ? idString(get(obj, 'id')) : '');
      if (matchId === wanted) collectItem(obj, wanted, output);
      // Matching another aweme is a hard boundary, so nested recommendations cannot inherit its ID.
      if (matchId && matchId !== wanted) continue;
      let keys;
      try { keys = Object.keys(obj); } catch (_) { continue; }
      for (const key of keys.slice(0, 3000)) {
        if (/^(?:author|authorInfo|user|userInfo|comments|commentList|music|statistics|stats|cookies|token|headers|_owner|_store|return|sibling|stateNode|dependencies|alternate|ref)$/i.test(key)) continue;
        const child = get(obj, key);
        if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
      }
    }
    return rankCandidates(output);
  }
  function collectItem(item, id, output) {
    if (get(item, 'is_ads') === true || get(item, 'isAds') === true || number(first(item, ['is_ads', 'isAds'])) === 1 || get(item, 'raw_ad_data') || get(item, 'ad_info')) return;
    const video = first(item, ['video', 'videoInfo', 'video_info']);
    const title = String(first(item, ['desc', 'title', 'caption', 'description']) || '抖音视频').slice(0, 500);
    const meta = {
      videoId: id, title,
      duration: mediaDuration(video, item),
      width: number(first(video, ['width', 'video_width'])), height: number(first(video, ['height', 'video_height'])),
      bitrate: number(first(video, ['bit_rate', 'bitrate'])), codec: codec(video), kind: 'video', fileName: filename(title, id)
    };
    if (video && typeof video === 'object') collectVideo(video, meta, output, 'DOUYIN.video', 0);
    // Some hydration variants place playAddr directly on the aweme object.
    collectVideo(item, meta, output, 'DOUYIN.item', 0, true);
    collectImageCandidates(item, { videoId: id, title, kind: 'image' }, output);
  }

  function imageFormat(value) {
    const raw = String(value || '').toLowerCase();
    const match = raw.match(/(?:image\/)?(jpeg|jpg|png|webp|gif|avif|heic|heif)/);
    return match ? match[1] : '';
  }
  function imageUrlValues(value, depth = 0) {
    if (depth > 3 || value === undefined || value === null) return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.slice(0, 20).flatMap(item => imageUrlValues(item, depth + 1));
    if (typeof value !== 'object') return [];
    const output = [];
    for (const key of ['url', 'src', 'uri', 'image_url', 'imageUrl']) {
      const child = get(value, key);
      if (typeof child === 'string') output.push(child);
    }
    return output;
  }
  function imageObjectUrls(obj) {
    if (!obj || typeof obj !== 'object') return [];
    const urls = [];
    for (const key of IMAGE_URL_KEYS) {
      const value = get(obj, key);
      for (const raw of imageUrlValues(value)) {
        const url = fullImageUrl(raw);
        if (url && !urls.includes(url)) urls.push(url);
      }
    }
    return urls;
  }
  function collectImageItems(value, inherited, output, path, depth = 0) {
    if (!value || depth > 7) return;
    if (typeof value === 'string') {
      const imageUrl = fullImageUrl(value);
      if (!imageUrl) return;
      const index = output.filter(item => item.kind === 'image').length;
      output.push({ ...inherited, videoUrl: imageUrl, imageUrl, backupUrls: [], source: path, imageIndex: index, width: 0, height: 0, fileName: imageFilename(inherited.title, inherited.videoId, index, imageUrl) });
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 80).forEach((entry, index) => collectImageItems(entry, inherited, output, path + '[' + index + ']', depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    const urls = imageObjectUrls(value);
    if (urls.length) {
      const index = Number.isInteger(inherited.imageIndex) ? inherited.imageIndex : output.filter(item => item.kind === 'image').length;
      const width = number(first(value, ['width', 'image_width', 'imageWidth'])) || inherited.width || 0;
      const height = number(first(value, ['height', 'image_height', 'imageHeight'])) || inherited.height || 0;
      const format = imageFormat(first(value, ['format', 'file_format', 'fileFormat', 'mime_type', 'mimeType', 'image_format', 'imageFormat'])) || imageFormat(urls[0]);
      const imageUrl = urls[0];
      output.push({
        ...inherited,
        videoUrl: imageUrl,
        imageUrl,
        backupUrls: urls.slice(1, 4),
        source: path,
        imageIndex: index,
        width,
        height,
        fileName: imageFilename(inherited.title, inherited.videoId, index, imageUrl, format)
      });
      return;
    }
    // Wrappers such as image_post_info contain the actual images array one level down.
    for (const key of Object.keys(value).slice(0, 100)) {
      if (!IMAGE_CONTAINER_KEYS.has(key)) continue;
      const child = get(value, key);
      if (child !== undefined) collectImageItems(child, inherited, output, path + '.' + key, depth + 1);
    }
  }
  function collectImageCandidates(item, inherited, output) {
    if (!item || typeof item !== 'object') return;
    const containers = [];
    for (const key of ['images', 'image_list', 'imageList', 'image_infos', 'imageInfos']) {
      const value = get(item, key);
      if (value !== undefined) containers.push([value, 'DOUYIN.' + key]);
    }
    for (const key of ['image_post_info', 'imagePostInfo', 'note_info', 'noteInfo']) {
      const value = get(item, key);
      if (value !== undefined) containers.push([value, 'DOUYIN.' + key]);
    }
    const before = output.length;
    for (const [value, path] of containers) collectImageItems(value, { ...inherited }, output, path);
    const images = output.slice(before).filter(candidate => candidate.kind === 'image');
    if (!images.length) return;
    const seen = new Set();
    let order = 0;
    for (const candidate of images) {
      if (seen.has(candidate.videoUrl)) { candidate._duplicateImage = true; continue; }
      seen.add(candidate.videoUrl);
      candidate.imageIndex = order++;
      candidate.fileName = imageFilename(inherited.title, inherited.videoId, candidate.imageIndex, candidate.videoUrl, candidate.fileName.split('.').pop());
    }
    for (const candidate of images) if (candidate._duplicateImage) {
      const index = output.indexOf(candidate);
      if (index >= 0) output.splice(index, 1);
    }
    const count = order;
    for (const candidate of output) if (candidate.kind === 'image' && candidate.videoId === inherited.videoId && candidate.imageIndex < count) {
      candidate.imageCount = count;
      candidate.imageSetId = inherited.videoId + ':images';
    }
  }
  function collectVideo(obj, inherited, output, path, depth, directOnly = false) {
    if (!obj || typeof obj !== 'object' || depth > 7 || unsafeFormat(obj)) return;
    const meta = {
      ...inherited,
      width: number(first(obj, ['width', 'video_width'])) || inherited.width,
      height: number(first(obj, ['height', 'video_height'])) || inherited.height,
      bitrate: number(first(obj, ['bit_rate', 'bitRate', 'bitrate'])) || inherited.bitrate,
      codec: codec(obj, inherited.codec)
    };
    for (const key of PLAY_KEYS) {
      const value = get(obj, key);
      if (value !== undefined) collectAddress(value, { ...meta, codec: /h264/i.test(key) ? 'h264' : /265|bytevc1/i.test(key) ? 'h265' : meta.codec }, output, path + '.' + key, 0);
    }
    if (!directOnly) for (const key of VARIANT_KEYS) {
      const list = get(obj, key);
      if (Array.isArray(list)) for (const variant of list.slice(0, 80)) collectVideo(variant, meta, output, path + '.' + key, depth + 1);
    }
  }
  function collectAddress(value, inherited, output, path, depth) {
    if (depth > 5 || !value) return;
    if (typeof value === 'string') {
      const videoUrl = fullVideoUrl(value);
      if (videoUrl) output.push({ ...inherited, videoUrl, source: path });
      return;
    }
    if (Array.isArray(value)) { for (const v of value.slice(0, 30)) collectAddress(v, inherited, output, path, depth + 1); return; }
    if (typeof value !== 'object' || unsafeFormat(value)) return;
    const meta = { ...inherited, width: number(get(value, 'width')) || inherited.width, height: number(get(value, 'height')) || inherited.height, codec: codec(value, inherited.codec) };
    for (const key of ['url_list', 'urlList', 'url', 'src', 'main_url', 'mainUrl', 'backup_url', 'backupUrl']) {
      const child = get(value, key);
      if (child !== undefined) collectAddress(child, meta, output, path, depth + 1);
    }
  }
  function htmlDecode(text) {
    return text.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  function balancedJson(text, offset) {
    let start = offset;
    while (/\s/.test(text[start] || '') && start < text.length) start++;
    if (text[start] !== '{' && text[start] !== '[') return '';
    let inString = false, escape = false, depth = 0;
    for (let i = start; i < text.length && i - start < MAX_TEXT; i++) {
      const ch = text[i];
      if (inString) { if (escape) escape = false; else if (ch === '\\') escape = true; else if (ch === '"') inString = false; continue; }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') { if (--depth === 0) return text.slice(start, i + 1); }
    }
    return '';
  }
  function extractFromHtml(html, targetId) {
    if (typeof html !== 'string' || html.length > MAX_TEXT || !idString(targetId)) return [];
    const out = [], re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let match, count = 0;
    while ((match = re.exec(html)) && count++ < 400) {
      const attrs = match[1], text = match[2].trim();
      if (!text) continue;
      if (/application\/(?:ld\+)?json|(?:RENDER_DATA|__NEXT_DATA__|__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE)/i.test(attrs) || /^[{[]/.test(text)) {
        let decoded = text;
        if (/%7[bB]|%5[bB]/.test(text.slice(0, 12))) { try { decoded = decodeURIComponent(text); } catch (_) {} }
        const parsed = parseJson(decoded) || parseJson(htmlDecode(decoded));
        if (parsed) out.push(...extractDouyin(parsed, targetId));
      }
      const assignment = /(?:window\s*\.\s*)?(?:_ROUTER_DATA|__INITIAL_STATE__|__NEXT_DATA__|__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE|__SSR_DATA__)\s*=\s*/g;
      let item;
      while ((item = assignment.exec(text))) {
        const parsed = parseJson(balancedJson(text, assignment.lastIndex));
        if (parsed) out.push(...extractDouyin(parsed, targetId));
      }
    }
    return rankCandidates(out);
  }
  return { normalizeUrl, isDouyinUrl, getDouyinId, parseJson, extractDouyin, extractFromHtml, rankCandidates, fullImageUrl };
});
