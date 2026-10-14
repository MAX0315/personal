/* Exact-note Xiaohongshu extraction. Parses public state without executing page code. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.XhsExtractor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_TEXT = 12 * 1024 * 1024;
  const MAX_NODES = 10000;
  const own = (obj, key) => {
    if (!obj || typeof obj !== 'object') return undefined;
    try { return Object.getOwnPropertyDescriptor(obj, key)?.value; } catch (_) { return undefined; }
  };
  const first = (obj, keys) => {
    for (const key of keys) { const value = own(obj, key); if (value !== undefined && value !== null && value !== '') return value; }
    return undefined;
  };
  const num = value => typeof value === 'number' || typeof value === 'string' ? (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0) : 0;
  const id = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value) ? value.toLowerCase() : '';
  function isXhsUrl(value) {
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password && ['xiaohongshu.com', 'xhslink.cn', 'xhslink.com'].some(d => u.hostname === d || u.hostname.endsWith('.' + d)); } catch (_) { return false; }
  }
  function getNoteId(value) {
    if (!isXhsUrl(value)) return '';
    try { return id(new URL(value).pathname.match(/^\/(?:explore|discovery\/item)\/([a-f\d]{24})(?:\/|$)/i)?.[1]); } catch (_) { return ''; }
  }
  function decodeHtml(text) {
    return String(text || '').replace(/&#(x[\da-f]+|\d+);/gi, (all, code) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }).replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
  }
  function attrs(text) {
    const result = Object.create(null), re = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let m;
    while ((m = re.exec(text.slice(0, 16000)))) result[m[1].toLowerCase()] = decodeHtml(m[2] ?? m[3] ?? m[4] ?? '');
    return result;
  }
  // The serialized state is JSON plus bare undefined/NaN values. Replace only
  // whole tokens outside strings, then let JSON.parse reject all executable syntax.
  function parseState(text) {
    if (typeof text !== 'string' || text.length > MAX_TEXT) return null;
    let output = '', quoted = false, escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        output += ch;
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
        continue;
      }
      if (ch === '"') { quoted = true; output += ch; continue; }
      if ((ch === 'u' || ch === 'N') && !/[\w$]/.test(text[i - 1] || '')) {
        const token = text.slice(i).match(/^(?:undefined|NaN)(?![\w$])/);
        if (token) { output += 'null'; i += token[0].length - 1; continue; }
      }
      output += ch;
    }
    try { return JSON.parse(output); } catch (_) { return null; }
  }
  function balanced(text, offset) {
    let start = offset;
    while (start < text.length && /\s/.test(text[start])) start++;
    if (text[start] !== '{' && text[start] !== '[') return '';
    const stack = [];
    let quoted = false, escaped = false;
    for (let i = start; i < text.length && i - start <= MAX_TEXT; i++) {
      const ch = text[i];
      if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
      if (ch === '"') quoted = true;
      else if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') {
        if (stack.pop() !== (ch === '}' ? '{' : '[')) return '';
        if (!stack.length) return text.slice(start, i + 1);
      }
    }
    return '';
  }
  function assignments(text) {
    const results = [];
    let quote = '', escaped = false;
    for (let i = 0; i < text.length && results.length < 10; i++) {
      const ch = text[i];
      if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '/' && text[i + 1] === '/') { const end = text.indexOf('\n', i + 2); i = end < 0 ? text.length : end; continue; }
      if (ch === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; continue; }
      if ((ch !== 'w' && ch !== '_') || /[\w$.]/.test(text[i - 1] || '')) continue;
      const found = text.slice(i).match(/^(?:window\s*\.\s*)?(?:__INITIAL_STATE__|__NEXT_DATA__|__SSR_DATA__)\s*=\s*(?!=)/);
      if (!found) continue;
      const raw = balanced(text, i + found[0].length), parsed = parseState(raw);
      if (parsed) results.push(parsed);
      i += found[0].length + Math.max(0, raw.length - 1);
    }
    return results;
  }
  function fullVideoUrl(value) {
    if (typeof value !== 'string' || !/^(?:https?:)?\/\//i.test(value)) return '';
    try {
      const normalized = value.startsWith('//') ? 'https:' + value : value;
      const u = new URL(normalized);
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) return '';
      // Only the platform's video CDNs, never unrelated advertisements or assets.
      if (!/^sns-(?:video(?:-[a-z0-9]+)*|bak-v\d+)\.xhscdn\.com$/i.test(u.hostname)) return '';
      const path = u.pathname.toLowerCase();
      if (/\.(?:m3u8|mpd|m4s|ts|aac|mp3|m4a|ogg|wav|flac|jpg|jpeg|png|webp|gif|svg|html?|js|css|zip|exe)(?:$|\/)/.test(path)) return '';
      if (/\/(?:dash|segment|segments|chunk|chunks|audio)\//.test(path)) return '';
      for (const key of u.searchParams.keys()) if (/^(?:range|byte_?start|byte_?end|start|end|segment|segment_index|chunk|chunk_index|part)$/i.test(key)) return '';
      if (/dash|mpegurl|audio/i.test(u.searchParams.get('mime_type') || u.searchParams.get('format') || '')) return '';
      return u.href;
    } catch (_) { return ''; }
  }
  function unsafeFormat(value) {
    return /dash|mpegurl|m3u8|audio|segment/i.test(String(first(value, ['format', 'mimeType', 'mime_type', 'mediaType', 'media_type']) || ''));
  }
  function codec(value, inherited = '') {
    const raw = String(first(value, ['videoCodec', 'video_codec', 'codec', 'codecType', 'codec_type']) || '').toLowerCase();
    return /hevc|h\.?265|hev1|hvc1/.test(raw) ? 'h265' : /avc|h\.?264/.test(raw) ? 'h264' : inherited;
  }
  function watermark(value, inherited = 'unknown') {
    let foundNone = false;
    for (const key of ['hasWatermark', 'has_watermark', 'watermark', 'waterMark', 'isWatermarked', 'is_watermarked']) {
      const v = own(value, key);
      if (v === true || v === 1 || v === '1' || v === 'true' || v === 'present') return 'present';
      if (v === false || v === 0 || v === '0' || v === 'false' || v === 'none') foundNone = true;
    }
    for (const key of ['noWatermark', 'no_watermark', 'withoutWatermark']) if ([true, 1, '1', 'true'].includes(own(value, key))) foundNone = true;
    return inherited === 'present' ? 'present' : foundNone ? 'none' : inherited;
  }
  function fileName(title, noteId) {
    return (String(title || '小红书视频').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 70) || '小红书视频') + '_' + noteId + '.mp4';
  }
  function renditionOf(streamDesc) {
    // Desktop X264_MP4 and WEB-designated renditions differ from the MINI_APP
    // distribution rendition. This describes origin, not verified watermark status.
    if (/(?:^|_)MINI_APP(?:_|$)/i.test(streamDesc)) return 'mini-app';
    if (/^(?:X264_MP4)$|(?:^|_)WEB(?:_|$)/i.test(streamDesc)) return 'web';
    return 'unknown';
  }
  function rankCandidates(items) {
    function compare(a, b) {
      // An explicitly watermarked resource never beats an unmarked candidate.
      const mark = x => x.watermark === 'present' ? 0 : x.watermark === 'none' ? 2 : 1;
      const rendition = x => { const r = x.rendition || renditionOf(x.streamDesc || ''); return r === 'web' ? 2 : r === 'mini-app' ? 0 : 1; };
      return (Number(b.watermark !== 'present') - Number(a.watermark !== 'present')) ||
        (mark(b) - mark(a)) || (Number(b.sourceRole === 'native-playback') - Number(a.sourceRole === 'native-playback')) ||
        (rendition(b) - rendition(a)) || (Number(b.codec === 'h264') - Number(a.codec === 'h264')) ||
        (num(b.width) * num(b.height) - num(a.width) * num(a.height)) || (num(b.bitrate) - num(a.bitrate));
    }
    const seen = new Map();
    for (const item of items || []) {
      if (!item?.videoUrl) continue;
      const old = seen.get(item.videoUrl);
      if (!old || compare(item, old) < 0) seen.set(item.videoUrl, item);
    }
    return Array.from(seen.values()).sort(compare).slice(0, 40);
  }
  function collectNote(note, targetId, out) {
    if (!note || typeof note !== 'object') return;
    for (const key of ['noteId', 'note_id', 'id']) {
      const explicitId = own(note, key);
      if (explicitId !== undefined && id(explicitId) !== targetId) return;
    }
    const type = first(note, ['type', 'noteType', 'note_type']);
    if (type !== undefined && type !== 'video') return;
    if (own(note, 'isAd') === true || own(note, 'is_ads') === true) return;
    const video = own(note, 'video');
    if (!video || typeof video !== 'object' || unsafeFormat(video)) return;
    const title = String(first(note, ['title', 'displayTitle', 'display_title', 'desc']) || '小红书视频').slice(0, 500);
    const capa = own(video, 'capa'), media = own(video, 'media'), info = own(media, 'video');
    const duration = num(first(capa, ['duration', 'durationSeconds'])) || num(first(video, ['durationSeconds', 'duration_seconds'])) || num(first(video, ['durationMs', 'duration_ms'])) / 1000 || num(own(video, 'duration'));
    const meta = { videoId: targetId, title, kind: 'video', fileName: fileName(title, targetId), duration,
      width: num(first(video, ['width'])) || num(own(info, 'width')), height: num(first(video, ['height'])) || num(own(info, 'height')),
      bitrate: num(first(video, ['videoBitrate', 'bitrate'])), codec: codec(video), watermark: watermark(video) };
    function add(value, source, inherited, sourceRole) {
      if (typeof value !== 'string') return;
      const videoUrl = fullVideoUrl(value);
      if (videoUrl) out.push({ ...inherited, videoUrl, source, sourceRole });
    }
    const stream = own(media, 'stream') || own(video, 'stream');
    if (stream && typeof stream === 'object') for (const name of ['h264', 'h265', 'h266', 'av1']) {
      const variants = own(stream, name);
      for (const variant of (Array.isArray(variants) ? variants : []).slice(0, 40)) {
        if (!variant || typeof variant !== 'object' || unsafeFormat(variant)) continue;
        const current = { ...meta, width: num(own(variant, 'width')) || meta.width, height: num(own(variant, 'height')) || meta.height,
          bitrate: num(first(variant, ['videoBitrate', 'video_bitrate', 'bitrate', 'bitRate'])) || meta.bitrate,
          duration: num(first(variant, ['durationMs', 'duration_ms', 'duration'])) / 1000 || meta.duration,
          codec: codec(variant, name), watermark: watermark(variant, meta.watermark),
          streamDesc: String(first(variant, ['streamDesc', 'stream_desc']) || '').slice(0, 100), streamType: num(first(variant, ['streamType', 'stream_type'])) };
        current.rendition = renditionOf(current.streamDesc);
        const source = 'XHS.video.media.stream.' + name;
        add(first(variant, ['masterUrl', 'master_url']), source + '.masterUrl', current, 'native-playback');
        const backups = first(variant, ['backupUrls', 'backup_urls']);
        for (const value of (Array.isArray(backups) ? backups : []).slice(0, 8)) add(value, source + '.backupUrls', current, 'native-playback');
      }
    }
    for (const key of ['masterUrl', 'master_url', 'playUrl', 'play_url']) add(own(video, key), 'XHS.video.' + key, meta, 'native-playback');
    for (const key of ['downloadUrl', 'download_url', 'downloadAddr', 'download_addr']) add(own(video, key), 'XHS.video.' + key, meta, 'share-download');
    // originVideoKey is an object key, not a URL. Never synthesize a CDN address.
  }
  function extractFromState(state, targetId) {
    const wanted = id(targetId), output = [], seen = new WeakSet();
    if (!wanted || !state || typeof state !== 'object') return output;
    const queue = [{ value: state, depth: 0 }];
    let visited = 0;
    while (queue.length && visited++ < MAX_NODES) {
      const { value, depth } = queue.pop();
      if (!value || typeof value !== 'object' || depth > 15 || seen.has(value)) continue;
      seen.add(value);
      const explicit = first(value, ['noteId', 'note_id']);
      if (explicit !== undefined && id(explicit) !== wanted) continue;
      if (id(explicit) === wanted) collectNote(value, wanted, output);
      const map = first(value, ['noteDetailMap', 'note_detail_map']);
      if (map && typeof map === 'object') {
        const entry = own(map, wanted), note = own(entry, 'note') || entry;
        const entryId = first(entry, ['noteId', 'note_id']);
        if (entryId === undefined || id(entryId) === wanted) collectNote(note, wanted, output);
      }
      let keys; try { keys = Object.keys(value); } catch (_) { continue; }
      for (const key of keys.slice(0, 1000)) {
        if (/^(?:noteDetailMap|note_detail_map|recommend\w*|related\w*|feeds?|comments?|user|author|music|ad\w*|video)$/i.test(key)) continue;
        const child = own(value, key);
        if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
      }
    }
    return rankCandidates(output);
  }
  function extractFromHtml(html, pageUrl) {
    const noteId = getNoteId(pageUrl), empty = { noteId, title: '', candidates: [] };
    if (!noteId || typeof html !== 'string' || html.length > MAX_TEXT) return empty;
    const clean = html.replace(/<!--[\s\S]*?-->/g, ''), output = [];
    const markup = clean.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    let title = decodeHtml(markup.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]).trim();
    for (const m of markup.matchAll(/<(?:link|meta)\b([^>]*)>/gi)) {
      const a = attrs(m[1]);
      if (/^og:title$/i.test(a.property || a.name || '') && a.content) title = a.content;
      const page = /(?:^|\s)canonical(?:\s|$)/i.test(a.rel || '') ? a.href : /^(?:og:url|twitter:url)$/i.test(a.property || a.name || '') ? a.content : '';
      if (page) { try { const declared = getNoteId(new URL(page, pageUrl).href); if (declared && declared !== noteId) return empty; } catch (_) {} }
    }
    let visits = 0;
    function jsonLd(value, depth) {
      if (!value || typeof value !== 'object' || depth > 8 || visits++ > 2000) return;
      if (Array.isArray(value)) { for (const child of value.slice(0, 100)) jsonLd(child, depth + 1); return; }
      const contextId = first(value, ['noteId', 'note_id']);
      if (contextId !== undefined && id(contextId) !== noteId) return;
      const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
      if (types.some(t => /^(?:https?:\/\/schema\.org\/)?VideoObject$/i.test(t || ''))) {
        let matched = true;
        for (const key of ['url', '@id', 'mainEntityOfPage']) {
          const raw = own(value, key), declared = typeof raw === 'string' ? raw : first(raw, ['@id', 'url']);
          if (declared) { try { if (getNoteId(new URL(declared, pageUrl).href) !== noteId) matched = false; } catch (_) { matched = false; } }
        }
        const explicit = first(value, ['noteId', 'note_id']);
        if (explicit !== undefined && id(explicit) !== noteId) matched = false;
        const videoUrl = fullVideoUrl(typeof value.contentUrl === 'string' ? value.contentUrl : own(value.contentUrl, 'url'));
        if (matched && videoUrl && !unsafeFormat(value) && !/audio|dash|mpegurl/i.test(String(value.encodingFormat || ''))) {
          const name = String(value.name || value.headline || title || '小红书视频').slice(0, 500);
          output.push({ videoId: noteId, title: name, kind: 'video', fileName: fileName(name, noteId), videoUrl, source: 'XHS.JSONLD.contentUrl', sourceRole: 'share-download', watermark: watermark(value), duration: 0, width: num(value.width), height: num(value.height), codec: '', bitrate: 0 });
        }
        return;
      }
      // Schema graphs and explicit page main entities only; no arbitrary nested video ads.
      for (const key of ['@graph', 'mainEntity', 'video']) jsonLd(own(value, key), depth + 1);
    }
    let count = 0;
    for (const match of clean.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (count++ >= 400) break;
      const a = attrs(match[1]), text = match[2].trim();
      if (!text || a.src) continue;
      if (/application\/ld\+json/i.test(a.type || '')) { const data = parseState(text); if (data) jsonLd(data, 0); continue; }
      if (/application\/json/i.test(a.type || '') || /^(?:__INITIAL_STATE__|__NEXT_DATA__|__SSR_DATA__)$/.test(a.id || '')) {
        const data = parseState(text); if (data) output.push(...extractFromState(data, noteId));
      }
      for (const data of assignments(text)) output.push(...extractFromState(data, noteId));
    }
    const candidates = rankCandidates(output);
    return { noteId, title: candidates[0]?.title || title, candidates };
  }
  return { isXhsUrl, getNoteId, parseState, extractFromState, extractFromHtml, rankCandidates };
});
