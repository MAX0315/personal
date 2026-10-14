/* Public-page resolution for MV3 workers. Never opens tabs or executes page scripts. */
(function (root, factory) {
  const extractor = root?.VideoExtractor || (typeof require === 'function' ? require('./extractor.cjs') : null);
  const xhs = root?.XhsExtractor || (typeof require === 'function' ? require('./xhs-extractor.cjs') : null);
  const bili = root?.BiliExtractor || (typeof require === 'function' ? require('./bilibili.cjs') : null);
  const api = factory(extractor, xhs, bili); api.createResolver = transport => factory(extractor, xhs, bili, transport);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LinkResolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E, X, B, fetchImpl) {
  'use strict';
  fetchImpl = fetchImpl || globalThis.fetch;
  const MAX_BYTES = 12 * 1024 * 1024;
  const REQUEST_MS = 8000;
  const TOTAL_MS = 19000;

  function decodeHtml(text) {
    return String(text || '').replace(/&#(x[\da-f]+|\d+);/gi, (all, code) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }).replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
  }
  function attrs(text) {
    const output = Object.create(null);
    const re = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let match;
    while ((match = re.exec(text.slice(0, 16000)))) output[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
    return output;
  }
  function markupOnly(html) {
    return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
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
  function scriptData(html) {
    const output = [], re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let match, count = 0;
    while ((match = re.exec(html)) && count++ < 400) {
      const a = attrs(match[1]);
      let body = match[2].trim();
      if (!body || a.src) continue;
      if (/application\/(?:ld\+)?json/i.test(a.type || '') || /^(?:RENDER_DATA|__NEXT_DATA__|__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE)$/.test(a.id || '') || /^[{[]/.test(body)) {
        if (/^%(?:7b|5b)/i.test(body)) { try { body = decodeURIComponent(body); } catch (_) {} }
        const parsed = E.parseJson(body) || E.parseJson(decodeHtml(body));
        if (parsed) output.push(parsed);
      }
      const assignment = /(?:window\s*\.\s*)?(?:_ROUTER_DATA|__INITIAL_STATE__|__NEXT_DATA__|__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE|__SSR_DATA__)\s*=\s*/g;
      let item;
      while ((item = assignment.exec(body))) {
        const parsed = E.parseJson(balanced(body, assignment.lastIndex));
        if (parsed) output.push(parsed);
      }
    }
    return output;
  }
  function canonicalIds(html, base) {
    const ids = new Set();
    for (const match of markupOnly(html).matchAll(/<(?:link|meta)\b([^>]*)>/gi)) {
      const a = attrs(match[1]);
      const value = /(?:^|\s)canonical(?:\s|$)/i.test(a.rel || '') ? a.href : /^(?:og:url|twitter:url)$/i.test(a.property || a.name || '') ? a.content : '';
      const id = value && E.getDouyinId(E.normalizeUrl(value, base));
      if (id) ids.add(id);
    }
    return [...ids];
  }
  function detailIdentity(html) {
    // Short-link pages may expose detail data without a redirect. A feed's aweme_list
    // or a lone arbitrary ID is never accepted as the shared video's identity.
    const ids = new Set();
    function ownId(value) {
      const raw = value && (value.aweme_id || value.awemeId || value.item_id || value.itemId);
      return typeof raw === 'string' && /^\d{8,24}$/.test(raw) ? raw : '';
    }
    function detail(value) {
      if (!value || typeof value !== 'object') return;
      const id = ownId(value);
      if (id && (value.video || value.videoInfo || value.video_info || value.images || value.image_list || value.imageList || value.image_post_info || value.imagePostInfo)) ids.add(id);
    }
    let visited = 0;
    function walk(value, depth, route = false) {
      if (!value || typeof value !== 'object' || depth > 8 || visited++ > 1500) return;
      for (const [key, child] of Object.entries(value).slice(0, 300)) {
        if (/^(?:aweme_detail|awemeDetail|itemStruct|itemDetail)$/.test(key)) detail(child);
        if (key === 'videoInfoRes') {
          detail(child?.aweme_detail);
          const list = child?.item_list || child?.itemList;
          if (Array.isArray(list)) for (const item of list.slice(0, 10)) detail(item);
        }
        if (/^(?:data|loaderData|itemInfo|videoInfoRes|detail|videoDetail|aweme)$/.test(key) || route && /(?:video|detail)/i.test(key)) walk(child, depth + 1, key === 'loaderData');
      }
    }
    for (const data of scriptData(html)) walk(data, 0);
    return ids.size === 1 ? [...ids][0] : '';
  }
  function cleanPageUrl(value) {
    const url = E.normalizeUrl(value);
    if (!url || !/^https?:\/\//i.test(String(value || ''))) throw new Error('请输入完整的 http(s) 链接');
    return url;
  }
  async function fetchText(url, deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('链接解析超时');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_MS, remaining));
    let reader;
    try {
      const response = await fetchImpl(url, { credentials: 'include', redirect: 'follow', signal: controller.signal });
      if (!response.ok) throw new Error('页面读取失败（' + response.status + '）');
      const finalUrl = E.normalizeUrl(response.url || url);
      if (!finalUrl) throw new Error('页面重定向无效');
      if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('页面超过 12 MB 解析上限');
      const type = response.headers.get('content-type') || '';
      if (type && !/text\/|(?:application\/(?:ld\+)?json)|(?:application\/xhtml\+xml)/i.test(type)) throw new Error('链接没有返回可解析的网页');
      let html = '';
      if (response.body?.getReader) {
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_BYTES) { controller.abort(); throw new Error('页面超过 12 MB 解析上限'); }
          html += decoder.decode(chunk.value, { stream: true });
        }
        html += decoder.decode();
      } else {
        html = await response.text();
        if (new TextEncoder().encode(html).byteLength > MAX_BYTES) throw new Error('页面超过 12 MB 解析上限');
      }
      return { html, url: finalUrl, type };
    } catch (error) {
      if (controller.signal.aborted && !/12 MB/.test(error.message)) throw new Error('链接读取超时，请重试');
      throw error;
    } finally {
      clearTimeout(timer);
      if (reader) { try { await reader.cancel(); } catch (_) {} }
    }
  }
  async function resolveDouyin(value) {
    let pageUrl;
    try { pageUrl = cleanPageUrl(value); } catch (error) { return { candidates: [], videoId: '', pageUrl: String(value || ''), reason: error.message, requiresPage: true }; }
    const noteRoute = /\/(?:note|share\/(?:note|slides))\//i.test(new URL(pageUrl).pathname);
    let videoId = E.getDouyinId(pageUrl), reason = '', challengeSeen = false;
    const deadline = Date.now() + TOTAL_MS, visited = new Set();
    if (!E.isDouyinUrl(pageUrl)) return { candidates: [], videoId, pageUrl, reason: '不是抖音分享链接', requiresPage: true };
    const urls = [pageUrl];
    let expanded = false;
    for (let index = 0; index < urls.length && index < 5 && Date.now() < deadline; index++) {
      const url = urls[index];
      if (visited.has(url)) continue;
      visited.add(url);
      try {
        const page = await fetchText(url, deadline);
        if (!E.isDouyinUrl(page.url)) throw new Error('分享链接跳转到了非抖音页面');
        const redirectId = E.getDouyinId(page.url), identities = canonicalIds(page.html, page.url);
        if (redirectId) identities.push(redirectId);
        const unique = [...new Set(identities)];
        if (unique.length > 1 || videoId && unique.some(id => id !== videoId)) throw new Error('页面作品 ID 与目标不一致，已阻止返回其他作品');
        if (!videoId) videoId = unique[0] || detailIdentity(page.html);
        if (videoId) {
          pageUrl = 'https://www.douyin.com/' + (noteRoute ? 'note/' : 'video/') + videoId;
          const data = E.parseJson(page.html);
          const candidates = data ? E.extractDouyin(data, videoId) : E.extractFromHtml(page.html, videoId);
          if (candidates.length) return { candidates, videoId, pageUrl, matched: true, method: 'link' };
        }
        challengeSeen ||= /验证码|安全验证|登录后|verifycenter|captcha|_\$jsvmprt/i.test(page.html);
        reason = challengeSeen ? '平台返回了登录或验证页面' : '公开页面暂未提供这条作品的完整媒体地址';
      } catch (error) { reason = error.message || '链接读取失败'; }
      if (videoId && !expanded) {
        expanded = true;
        urls.push('https://www.douyin.com/' + (noteRoute ? 'note/' : 'video/') + videoId,
          'https://www.douyin.com/' + (noteRoute ? 'video/' : 'note/') + videoId,
          'https://www.iesdouyin.com/share/' + (noteRoute ? 'note/' : 'video/') + videoId + '/',
          'https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=' + videoId);
        // De-duplicate before applying the request limit.
        const distinct = [...new Set(urls)]; urls.splice(0, urls.length, ...distinct);
      }
    }
    return { candidates: [], videoId, pageUrl, reason: reason || '无法从分享链接确认目标作品 ID', requiresPage: true };
  }
  async function resolveBilibili(value, providedPage) {
    let pageUrl;
    try { pageUrl = cleanPageUrl(value); } catch (error) { return { candidates: [], pageUrl: String(value || ''), reason: error.message, requiresPage: true }; }
    if (!B?.isBilibiliUrl(pageUrl)) return { candidates: [], pageUrl, reason: '不是哔哩哔哩视频链接', requiresPage: true };
    let page;
    try { page = providedPage || await fetchText(pageUrl, Date.now() + TOTAL_MS); }
    catch (error) { return { candidates: [], pageUrl, reason: error.message || '哔哩哔哩页面读取失败', requiresPage: true }; }
    if (!B.isBilibiliUrl(page.url)) return { candidates: [], pageUrl: page.url, reason: '短链接未跳转到哔哩哔哩视频页面', requiresPage: true };
    const info = B.infoFromHtml(page.html, page.url);
    const videoId = info.bvid || info.aid;
    const title = info.title || '哔哩哔哩视频';
    return { ...info, candidates: info.candidates, videoId, title, pageUrl: page.url, platform: 'bilibili', matched: !!info.candidates.length, method: 'link', requiresPage: !videoId, reason: videoId ? '' : '页面未返回有效的 BV/av 标识' };
  }
  function safeMedia(value, base, type = '') {
    const url = E.normalizeUrl(value, base);
    if (!url || /(?:audio|mpegurl|dash|octet-stream)/i.test(type)) return '';
    const u = new URL(url), path = u.pathname.toLowerCase();
    // Bilibili exposes player/API pages through og:video and JSON-LD. They are
    // HTML or JSON endpoints, never downloadable media files.
    if (/^(?:player|api)\.bilibili\.com$/i.test(u.hostname) || /^www\.bilibili\.com$/i.test(u.hostname) && /\/(?:player|api|playurl)(?:\/|$)/i.test(path)) return '';
    if (/douyin[_-]?pc[_-]?client|(?:^|[\/_-])(?:client_promo|download_banner|promotion|advertisement|adverts?|banner)(?:[\/_\-.]|$)/i.test(path)) return '';
    if (/\.(?:m3u8|mpd|m4s|ts|aac|mp3|m4a|ogg|wav|flac|jpg|jpeg|png|webp|gif|svg|html?|js|css|pdf|zip|exe|dmg|apk)(?:$|\/)/i.test(path)) return '';
    if (/\/(?:dash|segment|segments|chunk|chunks)\//i.test(path)) return '';
    if (!/\.mp4$|\.mov$|\.webm$|\.m4v$/i.test(path) && /\/(?:embed|watch|player)(?:\/|$)/i.test(path) && !/^video\//i.test(type)) return '';
    for (const key of u.searchParams.keys()) if (/^(?:range|byte_?start|byte_?end|start|end|segment|segment_index|chunk|chunk_index|part)$/i.test(key)) return '';
    if (/dash|mpegurl|audio/i.test(u.searchParams.get('mime_type') || u.searchParams.get('format') || '')) return '';
    return url;
  }
  function extractGenericFromHtml(html, pageUrl) {
    if (typeof html !== 'string' || html.length > MAX_BYTES) return [];
    const found = [], metadata = new Map(), markup = markupOnly(html);
    for (const match of markup.matchAll(/<meta\b([^>]*)>/gi)) {
      const a = attrs(match[1]), key = (a.property || a.name || '').toLowerCase();
      if (key && a.content && !metadata.has(key)) metadata.set(key, a.content);
    }
    const title = metadata.get('og:title') || decodeHtml(markup.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]).trim() || '视频';
    function add(value, source, score, itemTitle = title, type = '', extra = {}) {
      if (typeof value !== 'string' || !value.trim()) return;
      const videoUrl = safeMedia(value, pageUrl, type);
      if (!videoUrl || videoUrl.split('#')[0] === pageUrl.split('#')[0]) return;
      const ext = new URL(videoUrl).pathname.match(/\.(mp4|mov|webm|m4v)$/i)?.[1]?.toLowerCase() || 'mp4';
      const name = String(itemTitle || title).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 100) || '视频';
      found.push({ videoUrl, source, kind: 'video', title: String(itemTitle || title).slice(0, 500), fileName: name + '.' + ext, ...extra, _score: score });
    }
    // VideoObject.contentUrl denotes media; embedUrl denotes an HTML player and is excluded.
    let visits = 0;
    function visit(data, depth) {
      if (!data || typeof data !== 'object' || depth > 12 || visits++ > 5000) return;
      const types = Array.isArray(data['@type']) ? data['@type'] : [data['@type']];
      if (types.some(type => /^(?:https?:\/\/schema\.org\/)?VideoObject$/i.test(type || ''))) {
        const url = typeof data.contentUrl === 'string' ? data.contentUrl : data.contentUrl?.url;
        add(url, 'LINK.JSONLD.contentUrl', 100, data.name || data.headline || title, data.encodingFormat || '');
      }
      for (const child of Object.values(data).slice(0, 500)) if (child && typeof child === 'object') visit(child, depth + 1);
    }
    for (const data of scriptData(html)) visit(data, 0);
    const ogType = metadata.get('og:video:type') || '';
    // Explicit text/html is a player URL, not a downloadable file.
    if (!ogType || /^video\//i.test(ogType)) for (const key of ['og:video:secure_url', 'og:video:url', 'og:video']) add(metadata.get(key), 'LINK.' + key, 90, title, ogType);
    add(metadata.get('twitter:player:stream'), 'LINK.twitter:player:stream', 85, title, metadata.get('twitter:player:stream:content_type') || '');
    const videos = /<video\b([^>]*)>([\s\S]*?)(?:<\/video\s*>|$)|<video\b([^>]*)\/>/gi;
    let match, count = 0;
    while ((match = videos.exec(markup)) && count++ < 40) {
      const a = attrs(match[1] || match[3] || '');
      add(a.src, 'LINK.video', 60, title, a.type || '');
      for (const source of (match[2] || '').matchAll(/<source\b([^>]*)>/gi)) { const s = attrs(source[1]); add(s.src, 'LINK.video.source', 60, title, s.type || ''); }
    }
    const seen = new Set();
    return found.sort((a, b) => b._score - a._score).filter(item => { if (seen.has(item.videoUrl)) return false; seen.add(item.videoUrl); return true; }).slice(0, 24).map(({ _score, ...item }) => item);
  }
  async function resolveGeneric(value) {
    let pageUrl;
    try {
      pageUrl = cleanPageUrl(value);
      if (E.isDouyinUrl(pageUrl)) return resolveDouyin(pageUrl);
      const url = new URL(pageUrl);
      if (/\.(?:mp4|mov|webm|m4v)$/i.test(url.pathname) && safeMedia(pageUrl, pageUrl)) {
        const name = decodeURIComponent(url.pathname.split('/').pop());
        return { candidates: [{ videoUrl: pageUrl, kind: 'video', source: 'DIRECT', fileName: name }], pageUrl, method: 'link' };
      }
      const page = await fetchText(pageUrl, Date.now() + TOTAL_MS);
      if (B?.isBilibiliUrl(pageUrl) || B?.isBilibiliUrl(page.url)) return resolveBilibili(pageUrl, page);
      if (X?.isXhsUrl(pageUrl) || X?.isXhsUrl(page.url)) {
        if (!X.isXhsUrl(page.url)) throw new Error('小红书分享链接跳转到了其他网站，已停止解析');
        const expected = X.getNoteId(pageUrl), actual = X.getNoteId(page.url);
        if (expected && actual && expected !== actual) throw new Error('页面笔记 ID 与目标不一致，已阻止返回其他视频');
        const parsed = X.extractFromHtml(page.html, page.url);
        if (expected && parsed.noteId && parsed.noteId !== expected) throw new Error('页面笔记 ID 与目标不一致，已阻止返回其他视频');
        const candidates = parsed.candidates || [];
        const native = candidates.some(item => item.sourceRole === 'native-playback' && item.rendition !== 'mini-app' && item.watermark !== 'present');
        return {
          candidates, videoId: parsed.noteId || actual || expected, pageUrl: page.url,
          platform: 'xiaohongshu', matched: !!candidates.length, method: 'link', noOriginalSource: !native,
          ...(candidates.length ? {} : { requiresPage: true, reason: '小红书公开页面未返回目标视频的播放源，可能需要正常登录或验证。' })
        };
      }
      // A generic redirect to Douyin must enter the exact-ID resolver, not the generic scan.
      if (E.isDouyinUrl(page.url)) return { candidates: [], pageUrl: page.url, reason: '链接跳转到了抖音，请使用该抖音链接重新解析', requiresPage: true };
      const candidates = extractGenericFromHtml(page.html, page.url);
      return candidates.length ? { candidates, pageUrl: page.url, method: 'link' } : { candidates: [], pageUrl: page.url, reason: '公开页面没有完整视频地址，可能需要页面运行或正常登录', requiresPage: true };
    } catch (error) { return { candidates: [], pageUrl: pageUrl || String(value || ''), reason: error.message || '链接读取失败', requiresPage: true }; }
  }
  return { resolveDouyin, resolveBilibili, resolveGeneric, extractGenericFromHtml };
});
