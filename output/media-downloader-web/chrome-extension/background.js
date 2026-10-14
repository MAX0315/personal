importScripts('extractor.js', 'xhs-extractor.js', 'bilibili.js', 'link-resolver.js', 'channels.js', 'channels-browser.js', 'douyin-browser.js');
const E = globalThis.VideoExtractor;
const X = globalThis.XhsExtractor;
const B = globalThis.BiliExtractor;
const C = globalThis.ChannelsExtractor;
const BC = globalThis.BrowserChannels;
// Keep the controls visible during normal browser login and downloads.
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
const TTL = 15 * 60 * 1000;
function httpUrl(value) {
  const match = String(value || '').match(/https?:\/\/[^\s<>"“”]+/i);
  if (!match) throw new Error('请输入完整的 http(s) 链接，也可以粘贴抖音、视频号、小红书或哔哩哔哩分享链接');
  const url = new URL(match[0].replace(/[，。；！）)]+$/, ''));
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('链接格式不正确');
  return url.href;
}
function fileName(value, ext = 'mp4') {
  return (String(value || 'video').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 110) || 'video') + '.' + ext;
}
function directCandidate(url) {
  const path = new URL(url).pathname;
  const ext = path.match(/\.(mp4|mov|webm|m4v|m3u8|jpe?g|png|webp|gif|avif|heic|heif)$/i)?.[1]?.toLowerCase();
  if (!ext) return null;
  const kind = /^(?:jpe?g|png|webp|gif|avif|heic|heif)$/.test(ext) ? 'image' : ext === 'm3u8' ? 'hls' : 'video';
  return { videoUrl: url, imageUrl: kind === 'image' ? url : undefined, kind, source: 'DIRECT', fileName: fileName(decodeURIComponent(path.split('/').pop()), ext === 'jpeg' ? 'jpg' : ext) };
}
async function analyzeDouyin(pageUrl, preferredTabId) {
  const linked = await LinkResolver.resolveDouyin(pageUrl).catch(error => ({ reason: error.message }));
  if (linked.candidates?.length) return { ...linked, platform: 'douyin' };
  return BrowserDouyin.resolve(pageUrl, preferredTabId, linked);
}
async function readXhsTab(tabId, targetId) {
  const tab = await chrome.tabs.get(tabId);
  if (!targetId || X.getNoteId(tab.url) !== targetId) return [];
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['xhs-extractor.js'] });
  const injected = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', args: [targetId],
    func: id => {
      const extractor = globalThis.XhsExtractor;
      if (!extractor || extractor.getNoteId(location.href) !== id) return [];
      const state = extractor.extractFromState(globalThis.__INITIAL_STATE__, id);
      const page = extractor.extractFromHtml(document.documentElement.outerHTML, location.href);
      return extractor.rankCandidates([...state, ...(page.noteId === id ? page.candidates : [])]);
    }
  });
  const after = await chrome.tabs.get(tabId);
  if (X.getNoteId(after.url) !== targetId) return [];
  return (injected[0]?.result || []).filter(item => item.videoId === targetId && /^https?:\/\//.test(item.videoUrl));
}
async function analyzeXhs(pageUrl, preferredTabId, linked) {
  const targetId = linked.videoId || X.getNoteId(pageUrl) || X.getNoteId(linked.pageUrl);
  if (linked.candidates?.some(item => item.sourceRole === 'native-playback' && item.rendition !== 'mini-app' && item.watermark !== 'present')) return linked;
  const tabs = targetId ? await chrome.tabs.query({}) : [];
  const tab = tabs.filter(t => X.getNoteId(t.url) === targetId)
    .sort((a, b) => Number(b.id === preferredTabId) - Number(a.id === preferredTabId))[0];
  let candidates = linked.candidates || [];
  if (tab) {
    try { candidates = X.rankCandidates([...await readXhsTab(tab.id, targetId), ...candidates]); } catch (_) {}
  }
  if (candidates.length) return {
    ...linked, candidates, videoId: targetId, pageUrl: linked.pageUrl || pageUrl,
    platform: 'xiaohongshu', matched: true, method: tab ? 'existing-page' : 'link', tabId: tab?.id,
    noOriginalSource: !candidates.some(item => item.sourceRole === 'native-playback' && item.rendition !== 'mini-app' && item.watermark !== 'present')
  };
  return { error: (linked.reason || '小红书未提供目标视频的公开播放源。') + ' 可打开这条笔记，完成正常登录或验证后再点“使用当前页面”。', pageUrl: linked.pageUrl || pageUrl, videoId: targetId, requiresPage: true };
}
async function readBilibiliTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!B.isBilibiliUrl(tab.url)) return null;
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: () => ({ url: location.href, html: document.documentElement?.outerHTML || '' })
    });
    const page = injected[0]?.result;
    if (!page?.html || !B.isBilibiliUrl(page.url)) return null;
    return { ...B.infoFromHtml(page.html, page.url), pageUrl: page.url, tabId };
  } catch (_) { return null; }
}
async function fetchBilibiliPlayUrl(apiUrl, pageUrl, tabId) {
  try {
    const response = await fetch(apiUrl, { credentials: 'include', redirect: 'follow', cache: 'no-store', referrer: pageUrl, referrerPolicy: 'strict-origin-when-cross-origin' });
    if (response.ok) {
      const payload = await response.json();
      if (payload?.code === 0) return payload;
    }
  } catch (_) {}
  if (tabId == null) return null;
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', args: [apiUrl, pageUrl],
      func: async (url, referrer) => {
        try {
          const response = await fetch(url, { credentials: 'include', cache: 'no-store', referrer, referrerPolicy: 'strict-origin-when-cross-origin' });
          return response.ok ? await response.json() : null;
        } catch (_) { return null; }
      }
    });
    return injected[0]?.result?.code === 0 ? injected[0].result : null;
  } catch (_) { return null; }
}
async function analyzeBilibili(pageUrl, preferredTabId) {
  let linked = await LinkResolver.resolveBilibili(pageUrl);
  let tab = null;
  if ((!linked.videoId || !linked.cid) && preferredTabId != null) {
    const current = await readBilibiliTab(preferredTabId);
    if (current) linked = { ...linked, ...current, videoId: current.bvid || current.aid, matched: false, pageUrl: current.pageUrl || linked.pageUrl || pageUrl };
  }
  if (!linked.videoId) return { error: linked.reason || '没有识别到有效的 B 站 BV/av 视频标识。', pageUrl: linked.pageUrl || pageUrl, requiresPage: true };
  const tabs = await chrome.tabs.query({});
  tab = tabs.filter(item => B.isBilibiliUrl(item.url) && (B.getBvid(item.url) === linked.bvid || B.getAid(item.url) === linked.aid))
    .sort((a, b) => Number(b.id === preferredTabId) - Number(a.id === preferredTabId))[0];
  let candidates = linked.candidates || [];
  let usedQuality = 0;
  for (const quality of [80, 64, 32, 16]) {
    if (candidates.length || !linked.cid) break;
    const apiUrl = B.buildPlayUrl(linked, quality);
    const payload = await fetchBilibiliPlayUrl(apiUrl, linked.pageUrl || pageUrl, tab?.id);
    const parsed = B.candidatesFromApi(payload, linked);
    if (parsed.length) { candidates = parsed; usedQuality = quality; }
  }
  if (!candidates.length) {
    const detail = linked.hasDash ? '当前页面只提供 DASH 分离流，插件需要单文件 MP4 才能直接下载；请在 B 站页面完成登录/验证后重新解析。' : 'B 站没有返回可直接下载的单文件 MP4，可能受登录、会员、地区或试看限制。';
    return { error: detail, pageUrl: linked.pageUrl || pageUrl, videoId: linked.videoId, tabId: tab?.id, requiresPage: true };
  }
  return { ...linked, candidates, pageUrl: linked.pageUrl || pageUrl, videoId: linked.videoId, tabId: tab?.id, matched: true, method: usedQuality ? 'playurl-mp4' : linked.method };
}
function sameChannelsPage(left, right) {
  try {
    const a = C.parsePage(left), b = C.parsePage(right);
    return Boolean(a && b && (a.shortUri && b.shortUri && a.shortUri === b.shortUri || a.exportId && b.exportId && a.exportId === b.exportId));
  } catch (_) { return false; }
}
async function readChannelsTab(tabId, pageUrl) {
  try {
    const before = await chrome.tabs.get(tabId);
    if (!sameChannelsPage(before.url, pageUrl)) return [];
    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['channels.js', 'channels-hook.js'] });
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', args: [pageUrl],
      func: target => {
        const parser = globalThis.ChannelsExtractor;
        const a = parser?.parsePage(location.href), b = parser?.parsePage(target);
        if (!a || !b || !(a.shortUri && a.shortUri === b.shortUri || a.exportId && a.exportId === b.exportId)) return [];
        return typeof globalThis.__vodExtractChannelsCurrent === 'function' ? globalThis.__vodExtractChannelsCurrent() : [];
      }
    });
    const after = await chrome.tabs.get(tabId);
    if (!sameChannelsPage(after.url, pageUrl)) return [];
    const info = C.parsePage(pageUrl);
    return (Array.isArray(injected[0]?.result) ? injected[0].result : []).slice(0, 8).flatMap(item => {
      if (item.platform !== 'channels' || item.kind !== 'video' || item.videoId !== (info.exportId || info.shortUri) || item.encrypted || item.decodeKey) return [];
      // Revalidate data from the page in the extension's own realm.
      return C.extractFeed({ errCode: 0, data: { feedInfo: {
        description: item.title, [item.codec === 'h265' ? 'h265VideoInfo' : 'h264VideoInfo']: {
          videoUrl: item.videoUrl, durationSeconds: item.duration, width: item.width, height: item.height
        }
      } } }, info).candidates || [];
    });
  } catch (_) { return []; }
}
async function analyzeChannels(pageUrl, preferredTabId) {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.filter(item => sameChannelsPage(item.url, pageUrl))
    .sort((a, b) => Number(b.id === preferredTabId) - Number(a.id === preferredTabId))[0];
  if (tab) {
    const candidates = await readChannelsTab(tab.id, pageUrl);
    if (candidates.length) return { candidates, pageUrl, videoId: candidates[0].videoId, platform: 'channels', tabId: tab.id, matched: true, method: 'existing-page' };
  }
  const result = await BC.resolve(pageUrl, preferredTabId);
  return { ...result, pageUrl, tabId: tab?.id };
}
async function analyzeGeneric(pageUrl, preferredTabId) {
  if (B.isBilibiliUrl(pageUrl)) return analyzeBilibili(pageUrl, preferredTabId);
  const direct = directCandidate(pageUrl);
  if (direct) return { candidates: [direct], pageUrl };
  const linked = await LinkResolver.resolveGeneric(pageUrl).catch(error => ({ reason: error.message }));
  if (X.isXhsUrl(pageUrl) || X.isXhsUrl(linked.pageUrl)) return analyzeXhs(pageUrl, preferredTabId, linked);
  if (linked.candidates?.length) return linked;
  const tabs = await chrome.tabs.query({});
  const same = tabs.filter(t => t.url?.split('#')[0] === pageUrl.split('#')[0]);
  const tab = same.find(t => t.id === preferredTabId) || same[0];
  if (tab) {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    if (results[0]?.result?.length) return { candidates: results[0].result, pageUrl, tabId: tab.id };
  }
  return { error: linked.reason || '网页没有公开的完整媒体地址。可尝试使用已打开的页面，或粘贴媒体文件直链。', pageUrl, requiresPage: true };
}
async function analyze(message) {
  const pageUrl = httpUrl(message.pageUrl);
  const result = C.isChannelsUrl(pageUrl) ? await analyzeChannels(pageUrl, message.tabId) : E.isDouyinUrl(pageUrl) ? await analyzeDouyin(pageUrl, message.tabId) : await analyzeGeneric(pageUrl, message.tabId);
  if (result.error) return result;
  const now = Date.now();
  const saved = await chrome.storage.session.get(null);
  const expired = Object.entries(saved).filter(([key, value]) => key.startsWith('result:') && now - value.created > TTL).map(([key]) => key);
  if (expired.length) await chrome.storage.session.remove(expired);
  result.token = crypto.randomUUID();
  result.candidates = result.candidates.slice(0, 80).map((item, index) => {
    const current = String(item.fileName || '');
    const imageExt = /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.exec(current)?.[1]?.toLowerCase();
    const videoExt = /\.(webm|mov|m4v|mp4)$/i.exec(current)?.[1]?.toLowerCase();
    const ext = item.kind === 'image' ? (imageExt === 'jpeg' ? 'jpg' : imageExt || 'jpg') : videoExt || 'mp4';
    const fallback = item.kind === 'image' ? 'douyin_' + (item.videoId || 'image') + '_图' + String(index + 1).padStart(2, '0') : 'douyin_' + (item.videoId || 'video');
    return { ...item, fileName: fileName(item.fileName || item.title || fallback, ext) };
  });
  await chrome.storage.session.set({ ['result:' + result.token]: { ...result, created: now } });
  return result;
}
async function download(message) {
  const key = 'result:' + message.token;
  const saved = (await chrome.storage.session.get(key))[key];
  if (!saved || Date.now() - saved.created > TTL) throw new Error('解析结果已过期，请重新解析以获取新的媒体地址');
  const item = saved.candidates[message.index];
  if (!item || !['video', 'image'].includes(item.kind)) throw new Error('没有可下载的完整媒体文件');
  if (item.rejectedReason) throw new Error(item.rejectedReason);
  if (item.platform === 'channels') {
    if (!C.safeMedia(item.videoUrl)) throw new Error('视频号媒体地址无效，请重新解析。');
    await verifyChannelsVideo(item);
  }
  // Never copy playback Range headers: request the whole media file.
  const id = await chrome.downloads.download({ url: item.videoUrl, filename: item.fileName, saveAs: true, conflictAction: 'uniquify' });
  await chrome.storage.session.set({ lastDownload: { id, filename: item.fileName, started: Date.now() } });
  return { id };
}
async function verifyChannelsVideo(item) {
  if (item.encrypted || item.decodeKey) throw new Error('这个地址是尚未解码的播放流，请重新解析以获取完整 MP4。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let reader;
  try {
    const response = await fetch(item.videoUrl, { headers: { Range: 'bytes=0-65535' }, credentials: 'omit', redirect: 'follow', signal: controller.signal });
    if (!response.ok || /text\/|json|mpegurl|dash\+xml/i.test(response.headers.get('content-type') || '')) throw new Error('视频号视频地址已失效或没有返回视频，请重新解析。');
    if (response.status === 206) {
      const range = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get('content-range') || '');
      if (!range || +range[1] !== 0 || +range[2] < 15 || +range[2] >= +range[3]) throw new Error('服务器没有返回有效的视频开头，请重新解析。');
    }
    if (!response.body?.getReader) throw new Error('没有读取到可验证的视频数据，请重新解析。');
    reader = response.body.getReader();
    const prefix = new Uint8Array(65536);
    let count = 0, ended = false;
    while (count < prefix.length) {
      const { value, done } = await reader.read();
      if (done) { ended = true; break; }
      const size = Math.min(value.byteLength, prefix.length - count);
      prefix.set(value.subarray(0, size), count); count += size;
      if (count >= 1024) break;
    }
    const header = new DataView(prefix.buffer);
    let offset = 0, mp4 = false;
    while (offset + 16 <= count && offset < 1024) {
      const size = header.getUint32(offset);
      const type = String.fromCharCode(...prefix.subarray(offset+4, offset+8));
      const brand = String.fromCharCode(...prefix.subarray(offset+8, offset+12));
      if (type === 'ftyp' && size >= 16 && size % 4 === 0 && offset + size <= count && /^(?:isom|iso[2-9]|mp4[12]|avc[1-4]|av01|M4V |qt  )$/.test(brand)) { mp4 = true; break; }
      if (size < 8 || offset + size > count || !['free', 'skip', 'wide'].includes(type)) break;
      offset += size;
    }
    if (!mp4) throw new Error('这个地址没有返回标准 MP4，可能是加密内容或错误页面。已停止下载，请重新解析。');
    if (response.status === 200 && ended) {
      // A complete short response must have media/container boxes, not just a
      // plausible ftyp marker. A large response is only probed at its beginning.
      let hasMedia = false, hasMovie = false;
      for (let at = 0; at + 8 <= count;) {
        const size = header.getUint32(at);
        const type = String.fromCharCode(...prefix.subarray(at+4, at+8));
        if (size < 8 || at + size > count) break;
        if (type === 'mdat' && size > 8) hasMedia = true;
        if (type === 'moov' && size > 8) hasMovie = true;
        at += size;
      }
      if (!hasMedia || !hasMovie) throw new Error('响应只有文件头，没有有效的视频内容。已停止下载，请重新解析。');
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('视频号视频验证超时，请重新解析后再下载。');
    throw error;
  } finally {
    clearTimeout(timer); controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}
async function downloadImages(message) {
  const key = 'result:' + message.token;
  const saved = (await chrome.storage.session.get(key))[key];
  if (!saved || Date.now() - saved.created > TTL) throw new Error('解析结果已过期，请重新解析后下载图片');
  const selected = saved.candidates[message.index];
  if (!selected || selected.kind !== 'image') throw new Error('请选择一张已解析的图片');
  const setId = selected?.imageSetId;
  const images = saved.candidates
    .filter(item => item.kind === 'image' && (!setId || item.imageSetId === setId))
    .sort((a, b) => (Number(a.imageIndex) || 0) - (Number(b.imageIndex) || 0));
  if (!images.length) throw new Error('没有可批量下载的图片');
  const ids = [];
  const failed = [];
  for (const image of images) {
    let started = false, lastError = null;
    for (const url of [image.videoUrl, ...(Array.isArray(image.backupUrls) ? image.backupUrls : [])].filter(Boolean)) {
      try {
        ids.push(await chrome.downloads.download({ url, filename: image.fileName, saveAs: false, conflictAction: 'uniquify' }));
        started = true;
        break;
      } catch (error) { lastError = error; }
    }
    if (!started) failed.push({ filename: image.fileName, error: lastError?.message || '下载失败' });
  }
  if (!ids.length) throw new Error(failed[0]?.error || '图片下载未能启动');
  await chrome.storage.session.set({ lastDownload: { id: ids[ids.length - 1], ids, filename: images.length + ' 张图片', started: Date.now(), batchCount: images.length, failedCount: failed.length } });
  return { ids, count: ids.length, failedCount: failed.length };
}
let rejectionQueue = Promise.resolve();
function rejectCandidate(message) {
  const pending = rejectionQueue.then(async () => {
    const key = 'result:' + message.token;
    const saved = (await chrome.storage.session.get(key))[key];
    const item = saved?.candidates?.[message.index];
    const actual = Number(message.actualDuration);
    if (!item || !(item.duration > 0) || !Number.isFinite(actual) || actual <= 0 || Math.abs(actual - item.duration) <= Math.max(2, item.duration * 0.04)) return { ignored: true };
    const reason = '该播放源已检测到时长不一致，已阻止下载。请更换播放源或重新解析。';
    for (const candidate of saved.candidates) if (candidate.videoUrl === item.videoUrl) candidate.rejectedReason = reason;
    await chrome.storage.session.set({ [key]: saved });
    return { ok: true };
  });
  rejectionQueue = pending.catch(() => {});
  return pending;
}
async function downloadStatus() {
  const { lastDownload } = await chrome.storage.session.get('lastDownload');
  if (!lastDownload) return null;
  const ids = Array.isArray(lastDownload.ids) && lastDownload.ids.length ? lastDownload.ids : [lastDownload.id];
  const items = (await Promise.all(ids.map(async id => (await chrome.downloads.search({ id }))[0]))).filter(Boolean);
  if (!items.length) return null;
  const invalidItem = items.find(item => item.state === 'complete' && (/(?:text\/html|application\/json|text\/plain)/i.test(item.mime || '') || item.totalBytes > 0 && item.bytesReceived < item.totalBytes || item.bytesReceived === 0));
  const interrupted = items.find(item => item.state === 'interrupted');
  const active = items.find(item => item.state === 'in_progress');
  const state = active ? 'in_progress' : interrupted ? 'interrupted' : 'complete';
  return {
    id: lastDownload.id, state,
    bytesReceived: items.reduce((sum, item) => sum + (item.bytesReceived || 0), 0),
    totalBytes: items.reduce((sum, item) => sum + (item.totalBytes || 0), 0),
    error: interrupted?.error, invalid: Boolean(invalidItem), filename: lastDownload.filename,
    batchCount: lastDownload.batchCount || items.length, completeCount: items.filter(item => item.state === 'complete').length,
    failedCount: (lastDownload.failedCount || 0) + items.filter(item => item.state === 'interrupted').length
  };
}

// Parse results survive panel dismissal. Temporary origin tabs are managed by BC.
let analysisQueue = Promise.resolve();
function queueAnalysis(task) {
  const pending = analysisQueue.then(task);
  analysisQueue = pending.catch(() => {});
  return pending;
}
async function startAnalysis(message) {
  const pageUrl = httpUrl(message.pageUrl);
  const job = { jobId: crypto.randomUUID(), state: 'running', pageUrl, started: Date.now() };
  await queueAnalysis(() => chrome.storage.session.set({ lastAnalysis: job }));
  void (async () => {
    let result;
    try { result = await analyze({ ...message, pageUrl }); }
    catch (error) { result = { error: error.message || '解析失败', pageUrl }; }
    await queueAnalysis(async () => {
      const { lastAnalysis } = await chrome.storage.session.get('lastAnalysis');
      if (lastAnalysis?.jobId === job.jobId && lastAnalysis.state === 'running') {
        await chrome.storage.session.set({ lastAnalysis: { ...job, state: result.error ? 'error' : 'complete', result } });
      }
    });
  })().catch(() => {});
  return { jobId: job.jobId };
}
async function analysisStatus() {
  return queueAnalysis(async () => {
    const { lastAnalysis } = await chrome.storage.session.get('lastAnalysis');
    if (!lastAnalysis) return null;
    if (lastAnalysis.state === 'running' && Date.now() - lastAnalysis.started > 75000) {
      const failed = { ...lastAnalysis, state: 'error', result: { error: '解析超时或后台已重启，请重新解析。', pageUrl: lastAnalysis.pageUrl } };
      await chrome.storage.session.set({ lastAnalysis: failed });
      return failed;
    }
    if (Date.now() - lastAnalysis.started > TTL) return null;
    if (lastAnalysis.state === 'complete' && lastAnalysis.result?.token) {
      const key = 'result:' + lastAnalysis.result.token;
      const saved = (await chrome.storage.session.get(key))[key];
      if (!saved || Date.now() - saved.created > TTL) {
        return { ...lastAnalysis, state: 'error', result: { error: '解析结果已失效，请重新解析。', pageUrl: lastAnalysis.pageUrl } };
      }
      const { created, ...result } = saved;
      return { ...lastAnalysis, result };
    }
    return lastAnalysis;
  });
}

let creatingOffscreen;
let audioQueue = Promise.resolve();
const audioActive = job => job && ['preparing', 'fetching', 'converting', 'saving', 'in_progress'].includes(job.state);
function queueAudio(task) {
  const pending = audioQueue.then(task);
  audioQueue = pending.catch(() => {});
  return pending;
}
async function offscreenExists() {
  return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] })).length > 0;
}
async function ensureOffscreen() {
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = (async () => {
    if (!await offscreenExists()) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS', 'WORKERS'], justification: '在本地提取音轨并编码 MP3，关闭弹窗后继续转换。' });
  })();
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}
async function releaseAudio(jobId) {
  try {
    if (await offscreenExists()) {
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'releaseAudio', jobId });
      await chrome.offscreen.closeDocument();
    }
  } catch (_) {}
}
async function saveAudioState(job) {
  await chrome.storage.session.set({ lastAudio: { ...job, updated: Date.now() } });
}
async function audioStatus() {
  let { lastAudio: job } = await chrome.storage.session.get('lastAudio');
  if (!job) return null;
  if (job.downloadId && audioActive(job)) {
    const [item] = await chrome.downloads.search({ id: job.downloadId });
    if (item) {
      const invalid = item.state === 'complete' && (item.bytesReceived === 0 || /text\/|application\/json/.test(item.mime || '') || (item.totalBytes > 0 && item.bytesReceived < item.totalBytes));
      job = { ...job, state: invalid ? 'error' : item.state, bytesReceived: item.bytesReceived, totalBytes: item.totalBytes, error: invalid ? 'MP3 文件下载不完整，请重新转换。' : item.error };
      await saveAudioState(job);
      if (!audioActive(job)) await releaseAudio(job.jobId);
    } else {
      job = { ...job, state: 'error', error: '下载记录已移除，请重新下载 MP3。' };
      await saveAudioState(job); await releaseAudio(job.jobId);
    }
  } else if (audioActive(job) && (!await offscreenExists() || Date.now() - (job.updated || job.started) > 90000)) {
    job = { ...job, state: 'error', error: '音频任务已中断，请重新点击“下载 MP3”。' };
    await saveAudioState(job); await releaseAudio(job.jobId);
  }
  return job;
}
async function startAudio(message) {
  const existing = await audioStatus();
  if (audioActive(existing)) throw new Error('已有 MP3 任务在进行，请等待完成或先取消。');
  const key = 'result:' + message.token;
  const saved = (await chrome.storage.session.get(key))[key];
  if (!saved || Date.now() - saved.created > TTL) throw new Error('解析结果已过期，请重新解析后下载 MP3。');
  const item = saved.candidates[message.index];
  if (!item || item.kind !== 'video') throw new Error('当前播放源不支持提取 MP3，请选择完整视频文件。');
  if (item.rejectedReason) throw new Error(item.rejectedReason);
  if (item.platform === 'channels') {
    if (!C.safeMedia(item.videoUrl)) throw new Error('视频号媒体地址无效，请重新解析。');
    await verifyChannelsVideo(item);
  }
  const job = { jobId: crypto.randomUUID(), state: 'preparing', filename: fileName(item.fileName, 'mp3'), percent: 0, started: Date.now() };
  await saveAudioState(job);
  try {
    await ensureOffscreen();
    const reply = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'convertAudio', jobId: job.jobId, videoUrl: item.videoUrl, filename: job.filename, duration: Number(item.duration) || 0 });
    if (!reply || reply.error) throw new Error(reply?.error || '本地音频转换器未启动，请重新加载插件。');
  } catch (error) {
    await saveAudioState({ ...job, state: 'error', error: error.message });
    await releaseAudio(job.jobId);
    throw error;
  }
  return { jobId: job.jobId };
}
async function audioEvent(message) {
  const { lastAudio: job } = await chrome.storage.session.get('lastAudio');
  if (!job || job.jobId !== message.jobId || !audioActive(job)) return { ignored: true };
  if (message.type === 'audioProgress') {
    if (job.downloadId || job.state === 'saving') return { ignored: true };
    const phase = ['preparing', 'fetching', 'converting'].includes(message.phase) ? message.phase : job.state;
    await saveAudioState({ ...job, state: phase, percent: Math.min(100, Math.max(0, Number(message.percent) || 0)), detail: String(message.detail || '').slice(0, 240) });
  } else if (message.type === 'audioFailed') {
    await saveAudioState({ ...job, state: 'error', error: String(message.error || '音频转换失败') });
    await releaseAudio(job.jobId);
  } else if (message.type === 'audioReady') {
    if (job.downloadId || job.state === 'saving') return { ignored: true };
    if (!String(message.blobUrl || '').startsWith('blob:' + chrome.runtime.getURL('')) || !(message.bytes > 0)) throw new Error('音频转换结果无效');
    await saveAudioState({ ...job, state: 'saving', percent: 100 });
    try {
      const id = await chrome.downloads.download({ url: message.blobUrl, filename: job.filename, saveAs: true, conflictAction: 'uniquify' });
      await saveAudioState({ ...job, state: 'in_progress', percent: 100, downloadId: id });
    } catch (error) {
      await saveAudioState({ ...job, state: 'error', error: error.message || 'MP3 保存已取消' });
      await releaseAudio(job.jobId);
    }
  }
  return { ok: true };
}
async function cancelAudio() {
  const { lastAudio: job } = await chrome.storage.session.get('lastAudio');
  if (!audioActive(job)) return { ok: true };
  if (job.downloadId) await chrome.downloads.cancel(job.downloadId).catch(() => {});
  await saveAudioState({ ...job, state: 'cancelled' });
  await releaseAudio(job.jobId);
  return { ok: true };
}
chrome.downloads.onChanged?.addListener(delta => {
  if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') void queueAudio(audioStatus).catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'offscreen') return false;
  const own = sender.id === chrome.runtime.id;
  const fromOffscreen = own && !sender.tab && sender.url === chrome.runtime.getURL('offscreen.html');
  const fromPopup = own && sender.url === chrome.runtime.getURL('popup.html');
  if (!fromOffscreen && !fromPopup) return false;
  (async () => {
    if (fromOffscreen) {
      if (['audioProgress', 'audioReady', 'audioFailed'].includes(message.type)) return queueAudio(() => audioEvent(message));
      throw new Error('不支持的后台消息');
    }
    if (message.type === 'startAnalysis') return startAnalysis(message);
    if (message.type === 'analysisStatus') return analysisStatus();
    if (message.type === 'startAudio') return queueAudio(() => startAudio(message));
    if (message.type === 'rejectCandidate') return rejectCandidate(message);
    if (message.type === 'audioStatus') return queueAudio(audioStatus);
    if (message.type === 'cancelAudio') return queueAudio(cancelAudio);
    if (message.type === 'analyze') return analyze(message);
    if (message.type === 'download') return download(message);
    if (message.type === 'downloadImages') return downloadImages(message);
    if (message.type === 'downloadStatus') return downloadStatus();
    if (message.type === 'channelsBrowserStatus') return BC.status();
    if (message.type === 'channelsLogin') return BC.openLogin();
    if (message.type === 'downloadDataUrl') {
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(message.dataUrl || '') || message.dataUrl.length > 30000000) throw new Error('截图数据无效');
      return { id: await chrome.downloads.download({ url: message.dataUrl, filename: fileName(message.filename, 'jpg'), saveAs: true }) };
    }
    throw new Error('不支持的操作');
  })().then(sendResponse).catch(error => sendResponse({ error: error.message || '操作失败' }));
  return true;
});

importScripts('web-bridge.js');
