const $ = id => document.getElementById(id);
let currentResult = null;
let candidateIndex = 0;
let busy = false;
let requestSerial = 0;
let previewController = null;
let previewTimer = null;
let previewAttempts = new Set();
let durationMismatch = false;
let targetPageUrl = '';
let targetTabId = null;
let downloadPolling = null;
let analysisPolling = null;
let analysisJobId = null;
let audioPolling = null;
let audioRunning = false;
let audioStarting = false;
const send = message => chrome.runtime.sendMessage(message);
function isChannelsLink(value) {
  return /(?:channels\.weixin\.qq\.com|weixin\.qq\.com\/sph\/|视频号)/i.test(String(value || ''));
}
function setChannelsAccountState(value = {}) {
  const needsLogin = Boolean(value.needsLogin || ['needsLogin', 'needs-login', 'unauthenticated'].includes(value.status || value.state));
  const verified = Boolean(value.authenticated || value.loginVerified || value.loggedIn);
  const available = Boolean(value.available || ['available', 'ready'].includes(value.status || value.state));
  $('channelsAccount').classList.toggle('needs-login', needsLogin);
  $('channelsAccountBadge').textContent = needsLogin ? '需要登录' : verified ? '会话可用' : value.parsed ? '解析完成' : available ? '通道可用' : '等待检查';
  $('channelsAccountState').textContent = value.error || value.message || value.detail || (needsLogin ? '请在 Chrome 中完成腾讯元宝的正常登录，然后回到侧栏重新解析当前链接。' : verified ? '腾讯网页会话已确认，可以重新解析当前链接。' : value.parsed ? '已通过腾讯网页读取当前作品，可在下方预览与下载。' : available ? '浏览器解析通道可用；登录会话是否有效会在解析当前链接时确认。' : '点击“登录腾讯账号”完成首次登录，然后在此处解析链接。');
}
async function updateChannelsBrowserStatus() {
  $('channelsStatusBtn').disabled = true;
  try {
    const status = await send({ type: 'channelsBrowserStatus' });
    if (!status) throw new Error('暂时无法读取浏览器解析状态，请重试。');
    setChannelsAccountState(status);
  } catch (error) {
    setChannelsAccountState({ error: error.message || '暂时无法读取浏览器解析状态，请重试。' });
  } finally { $('channelsStatusBtn').disabled = false; }
}
async function openChannelsLogin() {
  $('channelsLoginBtn').disabled = true;
  try {
    const result = await send({ type: 'channelsLogin' });
    if (!result || result.error) throw new Error(result?.error || '无法打开腾讯登录页，请重试。');
    setChannelsAccountState({ needsLogin: true, message: '腾讯元宝登录页已打开。完成正常登录后，回到此侧栏点击“重新解析当前链接”。' });
  } catch (error) {
    setChannelsAccountState({ error: error.message || '无法打开腾讯登录页，请重试。' });
  } finally { $('channelsLoginBtn').disabled = false; }
}
function setStatus(text, type = '') {
  $('statusText').textContent = text;
  $('status').className = ('status ' + type).trim();
}
function setBusy(value) {
  busy = value;
  $('analyzeBtn').disabled = value;
  $('currentBtn').disabled = value;
  $('channelsRetryBtn').disabled = value;
}
function seconds(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '等待预览读取';
  const whole = Math.round(Number(value));
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}
function resetResult() {
  previewController?.abort();
  clearTimeout(previewTimer); previewTimer = null;
  previewAttempts.clear();
  currentResult = null;
  durationMismatch = false;
  $('downloadBtn').disabled = true;
  $('downloadImagesBtn').disabled = true;
  $('downloadImagesBtn').classList.add('hidden');
  $('audioBtn').disabled = true;
  $('audioBtn').classList.remove('hidden');
  $('frameBtn').disabled = true;
  $('frameBtn').classList.remove('hidden');
  $('previewWrap').classList.add('hidden');
  $('imagePreviewWrap').classList.add('hidden');
  $('imagePreview').removeAttribute('src');
  $('result').classList.add('hidden');
  const preview = $('preview');
  preview.pause();
  preview.removeAttribute('src');
  preview.load();
}
function previewCompatible(item) {
  if (item.kind !== 'video' || item.rejectedReason || item.previewCompatible === false) return false;
  const video = $('preview');
  if (typeof video.canPlayType !== 'function') return true;
  const codec = String(item.codec || '').toLowerCase();
  const type = /h[.\s_-]?26[45]|avc|hevc/.test(codec)
    ? (/265|hevc/.test(codec) ? 'video/mp4; codecs="hvc1.1.6.L93.B0"' : 'video/mp4; codecs="avc1.42E01E"')
    : /av1|av01/.test(codec) ? 'video/mp4; codecs="av01.0.05M.08"'
      : /vp9|vp09/.test(codec) ? 'video/webm; codecs="vp9"' : '';
  return !type || Boolean(video.canPlayType(type));
}
function candidateRendition(item) {
  if (item.rendition === 'web' || item.rendition === 'mini-app') return item.rendition;
  const descriptor = String(item.streamDesc || '');
  if (/(?:^|_)MINI_APP(?:_|$)/i.test(descriptor)) return 'mini-app';
  return /^X264_MP4$|(?:^|_)WEB(?:_|$)/i.test(descriptor) ? 'web' : 'unknown';
}
function sourcePriority(item) {
  if (item.watermark === 'present') return 5;
  if (item.watermark === 'none') return 0;
  if (item.sourceRole === 'native-playback' && candidateRendition(item) === 'web') return 1;
  if (item.sourceRole === 'native-playback' && candidateRendition(item) !== 'mini-app') return 2;
  return candidateRendition(item) === 'mini-app' ? 4 : 3;
}
function preferredCandidate(candidates) {
  const images = candidates.map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === 'image' && !item.rejectedReason)
    .sort((a, b) => (Number(a.item.imageIndex) || 0) - (Number(b.item.imageIndex) || 0));
  if (images.length) return images[0].index;
  const eligible = candidates.map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === 'video' && !item.rejectedReason);
  if (!eligible.length) return candidates.findIndex(item => item.kind === 'image' || item.kind === 'video' || item.kind === 'hls') >= 0 ? candidates.findIndex(item => item.kind === 'image' || item.kind === 'video' || item.kind === 'hls') : 0;
  eligible.sort((a, b) => sourcePriority(a.item) - sourcePriority(b.item) || a.index - b.index);
  const preferred = eligible.filter(({ item }) => sourcePriority(item) === sourcePriority(eligible[0].item));
  return (preferred.find(({ item }) => previewCompatible(item)) || preferred[0])?.index ?? 0;
}
function sourceDescription(item) {
  if (item.kind === 'image') return '原图 ' + String((Number(item.imageIndex) || 0) + 1) + '/' + String(item.imageCount || 1);
  const rendition = candidateRendition(item);
  const role = item.sourceRole === 'native-playback' ? (rendition === 'mini-app' ? '小程序播放源' : rendition === 'web' ? '网页原始播放源' : '原始播放源') : item.sourceRole === 'share-download' ? '分享下载源' : '播放源';
  const watermark = item.watermark === 'none' ? '无平台水印（来源声明）' : item.watermark === 'present' ? '含平台水印' : '水印未确认';
  return role + ' · ' + watermark;
}
function candidateNote(item) {
  if (item.kind === 'image') {
    const count = Number(item.imageCount) || currentResult.candidates.filter(candidate => candidate.kind === 'image').length || 1;
    return '已匹配抖音图文作品，共识别 ' + count + ' 张图片。可下载当前图片，或一次保存全部图片到浏览器默认下载目录。';
  }
  const content = currentResult.matched ? '已匹配作品 ID，自动预览并核对时长。' : '已自动加载预览，请核对视频内容。';
  if (item.platform === 'channels') return '已读取目标视频号作品的播放源。下载前会检查 MP4 文件头；地址可能过期，下载失败时请在此侧栏重新解析。保存后请确认播放正常。';
  if (item.platform === 'bilibili') return content + '已读取哔哩哔哩单文件 MP4 播放流；地址有时效，下载失败时请重新解析。';
  if (item.watermark === 'present') return content + '当前源明确含平台水印，请选择其他原始播放源。';
  if (item.watermark === 'none') return content + '当前源声明无平台水印；作者已嵌入画面的标记仍会保留。';
  if (candidateRendition(item) === 'mini-app') return content + '当前为小程序播放源，可能含平台水印，请以预览为准。';
  if (item.sourceRole === 'native-playback') return content + '已优先选择平台原始播放源；水印状态请以预览为准，作者已嵌入画面的标记仍会保留。';
  return content + '尚未确认无平台水印；分享下载源可能带水印，请以预览为准。';
}
async function getCurrentTab() {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}
async function analyze() {
  if (busy) return;
  const serial = ++requestSerial;
  resetResult();
  $('openPageBtn').classList.add('hidden');
  setBusy(true);
  clearInterval(analysisPolling); analysisPolling = null;
  analysisJobId = null;
  setStatus(isChannelsLink($('urlInput').value) ? '正在通过腾讯网页读取视频号链接，可在此侧栏等待结果…' : '正在解析链接，可在此侧栏等待结果…', 'busy');
  try {
    const tab = await getCurrentTab();
    const result = await send({ type: 'startAnalysis', pageUrl: $('urlInput').value, tabId: tab?.id });
    if (serial !== requestSerial) return;
    if (result?.needsLogin) setChannelsAccountState(result);
    if (result?.error || !result?.jobId) throw new Error(result?.error || '解析任务未启动');
    analysisJobId = result.jobId;
    analysisPolling = setInterval(() => pollAnalysis(serial), 900);
    await pollAnalysis(serial);
  } catch (error) {
    if (serial === requestSerial) { setStatus(error.message || '解析失败', 'error'); setBusy(false); }
  }
}
async function pollAnalysis(serial) {
  const expectedJobId = analysisJobId;
  if (!expectedJobId) return;
  try {
    const job = await send({ type: 'analysisStatus' });
    if (serial !== requestSerial || analysisJobId !== expectedJobId) return;
    if (!job) throw new Error('解析结果已过期或后台已重启，请重新解析。');
    if (job.error && !job.state) throw new Error(job.error);
    if (job.jobId !== expectedJobId) throw new Error('解析任务已被新的链接替换，请重新解析当前链接。');
    if (job.state === 'running') return;
    if (!['complete', 'error'].includes(job.state)) throw new Error('解析任务状态异常，请重新解析。');
    clearInterval(analysisPolling); analysisPolling = null; analysisJobId = null;
    setBusy(false);
    applyResult(job.result);
  } catch (error) {
    if (serial === requestSerial && analysisJobId === expectedJobId) {
      clearInterval(analysisPolling); analysisPolling = null; analysisJobId = null;
      setBusy(false); setStatus(error.message || '读取解析进度失败，请重试', 'error');
    }
  }
}
function applyResult(result) {
  try {
    targetPageUrl = result?.pageUrl || '';
    targetTabId = result?.tabId ?? null;
    const channelsResult = result?.platform === 'channels' || !result?.platform && (result?.needsLogin || isChannelsLink(result?.pageUrl || $('urlInput').value));
    if (channelsResult) setChannelsAccountState({ ...result, parsed: !result?.error && Boolean(result?.candidates?.length) });
    if (targetPageUrl && result?.error && !channelsResult) $('openPageBtn').classList.remove('hidden');
    if (result?.error || !result?.candidates?.length) throw new Error(result?.error || '未找到可用的媒体地址');
    currentResult = result;
    candidateIndex = preferredCandidate(result.candidates);
    previewAttempts.clear();
    const select = $('qualitySelect');
    select.replaceChildren();
    result.candidates.forEach((item, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      const size = item.width && item.height ? ' · ' + item.width + '×' + item.height : '';
      option.textContent = (index + 1) + '. ' + sourceDescription(item) + size + (item.codec ? ' · ' + item.codec : '') + (item.bitrate ? ' · ' + (item.bitrate / 1000000).toFixed(1) + ' Mbps' : '') + (item.rejectedReason ? ' · 已阻止' : !previewCompatible(item) && item.kind === 'video' ? ' · 浏览器可能不支持' : '');
      select.append(option);
    });
    select.value = String(candidateIndex);
    select.disabled = result.candidates.length < 2;
    $('result').classList.remove('hidden');
    renderCandidate();
  } catch (error) {
    setStatus(error.message || '解析失败', 'error');
  }
}
function renderCandidate(fallback = false) {
  previewController?.abort();
  clearTimeout(previewTimer); previewTimer = null;
  const item = currentResult.candidates[candidateIndex];
  const isImage = item.kind === 'image';
  const imageCount = currentResult.candidates.filter(candidate => candidate.kind === 'image' && (!item.imageSetId || candidate.imageSetId === item.imageSetId)).length;
  durationMismatch = Boolean(item.rejectedReason);
  const preview = $('preview');
  const imagePreview = $('imagePreview');
  preview.pause();
  preview.removeAttribute('src'); preview.load();
  imagePreview.onload = null;
  imagePreview.onerror = null;
  imagePreview.removeAttribute('src');
  $('previewWrap').classList.add('hidden');
  $('imagePreviewWrap').classList.add('hidden');
  $('previewBtn').classList[isImage ? 'add' : 'remove']('hidden');
  $('previewBtn').disabled = item.kind !== 'video';
  $('sourceChip').textContent = isImage ? 'DOUYIN NOTE' : currentResult.platform === 'channels' ? '视频号' : currentResult.platform === 'bilibili' ? 'BILIBILI' : currentResult.matched ? 'ID MATCH' : item.source;
  $('resultTitle').textContent = isImage ? '已匹配图文作品' : currentResult.matched ? '已匹配目标作品' : '已找到播放源';
  $('videoTitle').textContent = item.title || (isImage ? '图片直链' : '视频直链');
  $('videoId').textContent = item.videoId || '普通页面';
  $('durationLabel').textContent = isImage ? '图片序号' : '视频时长';
  $('duration').textContent = isImage ? String((Number(item.imageIndex) || 0) + 1) + ' / ' + String(item.imageCount || imageCount || 1) : seconds(item.duration);
  $('fileName').textContent = item.fileName;
  $('fileName').title = item.fileName;
  $('sourceUrl').textContent = new URL(item.videoUrl).hostname;
  $('downloadBtn').textContent = isImage ? '下载当前图片' : '下载视频';
  $('downloadBtn').disabled = durationMismatch || !['video', 'image'].includes(item.kind);
  $('downloadImagesBtn').classList[isImage && imageCount > 1 ? 'remove' : 'add']('hidden');
  $('downloadImagesBtn').disabled = !isImage || imageCount < 2;
  $('audioBtn').classList[isImage ? 'add' : 'remove']('hidden');
  $('frameBtn').classList[isImage ? 'add' : 'remove']('hidden');
  updateAudioButton();
  $('frameBtn').disabled = true;
  $('resultNote').textContent = candidateNote(item);
  if (durationMismatch) {
    $('previewBtn').disabled = true;
    $('resultNote').textContent = item.rejectedReason;
    setStatus('该播放源时长不一致，请换源或重新解析', 'error');
    return;
  }
  if (isImage) {
    const result = currentResult;
    const index = candidateIndex;
    $('imagePreviewWrap').classList.remove('hidden');
    setStatus('已识别 ' + (item.imageCount || imageCount || 1) + ' 张图片，正在加载第 ' + ((Number(item.imageIndex) || 0) + 1) + ' 张预览…', 'busy');
    imagePreview.onload = () => {
      if (currentResult !== result || candidateIndex !== index) return;
      setStatus('图片预览已加载，可下载当前图片或全部图片', 'success');
    };
    imagePreview.onerror = () => {
      if (currentResult !== result || candidateIndex !== index) return;
      setStatus('图片预览暂不可用，仍可直接下载原图', '');
      $('resultNote').textContent = candidateNote(item) + ' 当前预览未加载，可能是临时签名或防盗链限制；下载失败时请重新解析。';
    };
    imagePreview.referrerPolicy = 'no-referrer';
    imagePreview.src = item.videoUrl;
    return;
  }
  if (item.kind !== 'video') {
    preview.removeAttribute('src');
    preview.load();
    $('resultNote').textContent = '该地址是 HLS 播放清单，不能直接保存成完整 MP4。';
    setStatus('该播放源暂不支持完整文件下载', 'error');
    return;
  }
  loadPreview(fallback);
}
function loadPreview(fallback = false) {
  if (!currentResult || currentResult.candidates[candidateIndex]?.kind !== 'video' || currentResult.candidates[candidateIndex]?.rejectedReason) return;
  previewController?.abort();
  clearTimeout(previewTimer);
  previewController = new AbortController();
  const signal = previewController.signal;
  const result = currentResult;
  const index = candidateIndex;
  const item = currentResult.candidates[candidateIndex];
  const preview = $('preview');
  previewAttempts.add(index);
  let checkedDuration = false;
  const isSelected = () => !signal.aborted && currentResult === result && candidateIndex === index;
  const isCurrent = () => isSelected() && (!preview.currentSrc || preview.currentSrc === item.videoUrl);
  const clearPreviewTimer = () => { clearTimeout(previewTimer); previewTimer = null; };
  signal.addEventListener('abort', clearPreviewTimer, { once: true });
  const failed = timeout => {
    if (!(timeout ? isSelected() : isCurrent()) || durationMismatch) return;
    clearPreviewTimer();
    $('frameBtn').disabled = true;
    const replacement = result.candidates.findIndex((candidate, next) => !previewAttempts.has(next) && candidate.sourceRole === 'native-playback' && candidateRendition(candidate) !== 'mini-app' && candidate.watermark !== 'present' && sourcePriority(candidate) <= sourcePriority(item) && previewCompatible(candidate));
    if (replacement >= 0) {
      candidateIndex = replacement;
      $('qualitySelect').value = String(replacement);
      renderCandidate(true);
      return;
    }
    $('previewBtn').classList.remove('hidden');
    $('previewBtn').textContent = '重新加载预览';
    const unsupported = !previewCompatible(item);
    $('resultNote').textContent = candidateNote(item) + (unsupported ? '浏览器可能不支持当前视频编码，可直接下载后用兼容播放器打开。' : checkedDuration ? '已核对播放时长，但预览画面暂不可用。' : '尚未核对播放时长。') + '可重试预览或手动切换播放源。';
    setStatus(unsupported ? '当前编码可能不支持预览，仍可下载视频或 MP3' : timeout ? '预览加载超时，可重试或切换播放源' : '已找到播放源，但预览暂不可用', '');
  };
  $('previewWrap').classList.remove('hidden');
  $('previewBtn').classList.add('hidden');
  preview.preload = 'auto';
  preview.autoplay = false;
  preview.pause();
  preview.addEventListener('loadedmetadata', () => {
    if (!isCurrent()) return;
    const actual = preview.duration;
    if (!Number.isFinite(actual) || actual <= 0) return;
    checkedDuration = true;
    if (result.matched && item.duration > 0 && Math.abs(actual - item.duration) > Math.max(2, item.duration * 0.04)) {
      clearPreviewTimer();
      durationMismatch = true;
      for (const candidate of result.candidates) if (candidate.videoUrl === item.videoUrl) candidate.rejectedReason = '该播放源已检测到时长不一致，请更换播放源或重新解析。';
      void send({ type: 'rejectCandidate', token: result.token, index, actualDuration: actual }).catch(() => {});
      $('downloadBtn').disabled = true;
      $('audioBtn').disabled = true;
      $('frameBtn').disabled = true;
      $('resultNote').textContent = '预期时长 ' + seconds(item.duration) + '，播放源时长 ' + seconds(actual) + '。已阻止下载，请换一个播放源或刷新目标页面后重新解析。';
      setStatus('视频时长不一致，已阻止下载', 'error');
    } else {
      $('duration').textContent = seconds(actual);
      $('previewBtn').classList.add('hidden');
      $('resultNote').textContent = candidateNote(item);
      setStatus(result.matched ? '预览时长检查通过，正在加载画面…' : '已读取视频时长，正在加载画面…', 'busy');
    }
  }, { signal });
  preview.addEventListener('loadeddata', () => {
    if (!isCurrent() || durationMismatch || !checkedDuration) return;
    clearPreviewTimer();
    $('frameBtn').disabled = false;
    $('previewBtn').classList.add('hidden');
    $('resultNote').textContent = candidateNote(item);
    setStatus(result.matched ? '作品 ID 已匹配，预览时长检查通过' : '预览已加载，请核对内容后下载', 'success');
  }, { signal });
  preview.addEventListener('error', () => failed(false), { signal });
  previewTimer = setTimeout(() => failed(true), 15000);
  setStatus(fallback === true ? '已自动切换原始播放源，正在加载预览…' : (result.matched ? '作品 ID 已匹配，正在自动加载预览…' : '已找到播放源，正在自动加载预览…'), 'busy');
  preview.src = item.videoUrl;
  preview.load();
}

function updateAudioButton() {
  $('audioBtn').disabled = audioRunning || audioStarting || !currentResult || durationMismatch || currentResult.candidates[candidateIndex]?.kind !== 'video';
}
async function updateAudioStatus() {
  try {
    const job = await send({ type: 'audioStatus' });
    if (!job || job.error && !job.state) return;
    $('audioTask').classList.remove('hidden');
    const labels = { preparing: '正在准备浏览器内转换…', fetching: '正在读取源文件', converting: '正在转换 MP3', saving: '转换完成，请选择 MP3 保存位置', in_progress: '正在保存 MP3', complete: 'MP3 下载完成：' + job.filename, cancelled: 'MP3 任务已取消', interrupted: 'MP3 下载中断：' + (job.error || '请重试'), error: 'MP3 处理失败：' + (job.error || '请重试') };
    audioRunning = ['preparing', 'fetching', 'converting', 'saving', 'in_progress'].includes(job.state);
    const percent = Math.min(100, Math.max(0, Number(job.percent) || 0));
    $('audioState').textContent = (labels[job.state] || '正在处理音频') + (['fetching', 'converting'].includes(job.state) ? ' · ' + percent.toFixed(0) + '%' : '') + (job.detail && audioRunning && job.state !== 'saving' ? ' · ' + job.detail : '');
    $('audioProgress').value = job.state === 'complete' ? 100 : percent;
    $('cancelAudioBtn').classList[audioRunning ? 'remove' : 'add']('hidden');
    $('cancelAudioBtn').disabled = job.state === 'saving';
    updateAudioButton();
    if (audioRunning && !audioPolling) audioPolling = setInterval(updateAudioStatus, 1000);
    if (!audioRunning) { clearInterval(audioPolling); audioPolling = null; }
  } catch (error) { $('audioState').textContent = '暂时无法读取 MP3 进度：' + error.message; }
}
async function downloadAudio() {
  if (!currentResult || durationMismatch || audioRunning || audioStarting || currentResult.candidates[candidateIndex]?.kind !== 'video') return;
  audioStarting = true; updateAudioButton();
  try {
    const response = await send({ type: 'startAudio', token: currentResult.token, index: candidateIndex });
    if (!response || response.error) throw new Error(response?.error || 'MP3 任务未启动');
    await updateAudioStatus();
  } catch (error) { setStatus(error.message || 'MP3 提取失败', 'error'); }
  finally { audioStarting = false; updateAudioButton(); }
}
async function useCurrentPage() {
  try {
    const tab = await getCurrentTab();
    if (!tab?.url || !/^https?:/i.test(tab.url)) throw new Error('当前页面不是可读取的网页');
    $('urlInput').value = tab.url;
    await analyze();
  } catch (error) { setStatus(error.message, 'error'); }
}
async function updateDownloadStatus() {
  try {
    const item = await send({ type: 'downloadStatus' });
    if (!item || item.error && !item.state) return;
    if (item.state === 'complete') {
      $('downloadState').textContent = item.invalid ? '下载文件可能是错误页面或不完整文件，请重新解析后下载。' : item.batchCount > 1 ? 'Chrome 已报告图片下载完成：' + item.completeCount + ' / ' + item.batchCount + ' 张。' : 'Chrome 已报告文件下载完成：' + item.filename;
      clearInterval(downloadPolling); downloadPolling = null;
    } else if (item.state === 'interrupted') {
      $('downloadState').textContent = (item.batchCount > 1 ? '有图片下载中断：' : '下载中断：') + (item.error || '请重新解析后再试') + '。请查看 Chrome 下载列表。';
      clearInterval(downloadPolling); downloadPolling = null;
    } else {
      const mb = (item.bytesReceived / 1048576).toFixed(1);
      $('downloadState').textContent = item.batchCount > 1 ? '正在下载图片：' + item.completeCount + ' / ' + item.batchCount + ' 张，已接收 ' + mb + ' MB' : '正在下载：' + mb + (item.totalBytes > 0 ? ' / ' + (item.totalBytes / 1048576).toFixed(1) : '') + ' MB';
      if (!downloadPolling) downloadPolling = setInterval(updateDownloadStatus, 1500);
    }
  } catch (_) {}
}
async function downloadSelected() {
  const selected = currentResult?.candidates[candidateIndex];
  if (!currentResult || durationMismatch || !['video', 'image'].includes(selected?.kind)) return;
  $('downloadBtn').disabled = true;
  try {
    const response = await send({ type: 'download', token: currentResult.token, index: candidateIndex });
    if (response?.error) throw new Error(response.error);
    $('downloadState').textContent = (selected.kind === 'image' ? '图片' : '视频') + '下载已启动，正在等待 Chrome 报告完成…';
    await updateDownloadStatus();
  } catch (error) { setStatus(error.message || '下载失败', 'error'); }
  finally { $('downloadBtn').disabled = !currentResult || durationMismatch || !['video', 'image'].includes(currentResult.candidates[candidateIndex]?.kind); }
}
async function downloadAllImages() {
  const selected = currentResult?.candidates[candidateIndex];
  if (!currentResult || selected?.kind !== 'image' || Number(selected.imageCount) < 2) return;
  $('downloadImagesBtn').disabled = true;
  try {
    const response = await send({ type: 'downloadImages', token: currentResult.token, index: candidateIndex });
    if (response?.error) throw new Error(response.error);
    $('downloadState').textContent = '已启动 ' + response.count + ' 张图片下载，文件会保存到 Chrome 默认下载目录。';
    if (response.failedCount) $('downloadState').textContent += ' 有 ' + response.failedCount + ' 张未启动，请重新解析后重试。';
    setStatus('图片批量下载已启动', 'success');
    await updateDownloadStatus();
  } catch (error) { setStatus(error.message || '批量下载失败', 'error'); }
  finally { $('downloadImagesBtn').disabled = false; }
}
function waitMedia(video, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('首帧读取超时')), 15000);
    const done = () => finish();
    const failed = () => finish(new Error('该播放源不允许跨域读取首帧，请尝试其他播放源'));
    function finish(error) {
      clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', failed);
      error ? reject(error) : resolve();
    }
    video.addEventListener(event, done, { once: true });
    video.addEventListener('error', failed, { once: true });
  });
}
async function downloadFrame() {
  if (!currentResult || durationMismatch) return;
  const frameResult = currentResult;
  const frameIndex = candidateIndex;
  const item = currentResult.candidates[candidateIndex];
  $('frameBtn').disabled = true;
  const video = document.createElement('video');
  try {
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    const ready = waitMedia(video, 'loadeddata');
    video.src = item.videoUrl; video.load();
    await ready;
    const seeked = waitMedia(video, 'seeked');
    video.currentTime = Math.min(0.04, (video.duration || 1) / 2);
    await seeked;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const response = await send({ type: 'downloadDataUrl', dataUrl: canvas.toDataURL('image/jpeg', 0.94), filename: item.fileName.replace(/\.[^.]+$/, '') + '-首帧.jpg' });
    if (response?.error) throw new Error(response.error);
    setStatus('首帧已发送到 Chrome 下载列表', 'success');
  } catch (error) { setStatus(error.message || '首帧读取失败', 'error'); }
  finally {
    video.removeAttribute('src'); video.load();
    if (currentResult === frameResult && candidateIndex === frameIndex) {
      $('frameBtn').disabled = durationMismatch || currentResult.candidates[candidateIndex]?.kind !== 'video' || !$('preview').videoWidth;
    }
  }
}
$('analyzeBtn').addEventListener('click', analyze);
$('currentBtn').addEventListener('click', useCurrentPage);
$('channelsStatusBtn').addEventListener('click', updateChannelsBrowserStatus);
$('channelsLoginBtn').addEventListener('click', openChannelsLogin);
$('channelsRetryBtn').addEventListener('click', analyze);
$('downloadBtn').addEventListener('click', downloadSelected);
$('downloadImagesBtn').addEventListener('click', downloadAllImages);
$('audioBtn').addEventListener('click', downloadAudio);
$('previewBtn').addEventListener('click', () => { previewAttempts.clear(); loadPreview(); });
$('cancelAudioBtn').addEventListener('click', async () => {
  try {
    const result = await send({ type: 'cancelAudio' });
    if (result?.error) throw new Error(result.error);
    await updateAudioStatus();
  } catch (error) { setStatus(error.message, 'error'); }
});
$('frameBtn').addEventListener('click', downloadFrame);
$('qualitySelect').addEventListener('change', () => { candidateIndex = Number($('qualitySelect').value); previewAttempts.clear(); renderCandidate(); });
$('urlInput').addEventListener('keydown', event => { if (event.key === 'Enter') analyze(); });
$('urlInput').addEventListener('input', () => {
  requestSerial++; setBusy(false); resetResult();
  clearInterval(analysisPolling); analysisPolling = null; analysisJobId = null;
  $('openPageBtn').classList.add('hidden');
  setStatus('链接已修改，请重新解析');
});
$('openPageBtn').addEventListener('click', async () => {
  if (!targetPageUrl) return;
  if (targetTabId != null) {
    try {
      const tab = await chrome.tabs.get(targetTabId);
      if (tab.url?.split('#')[0] === targetPageUrl.split('#')[0]) {
        await chrome.tabs.update(targetTabId, { active: true }); return;
      }
    } catch (_) {}
  }
  await chrome.tabs.create({ url: targetPageUrl, active: true });
});
(async () => {
  const serial = requestSerial;
  try {
    const [tab, job] = await Promise.all([getCurrentTab(), send({ type: 'analysisStatus' })]);
    if (serial === requestSerial) {
      if (job?.pageUrl) {
        $('urlInput').value = job.pageUrl;
        analysisJobId = job.jobId;
        if (job.state === 'running') {
          setBusy(true); setStatus('正在后台解析链接，可关闭侧栏后回来查看…', 'busy');
          analysisPolling = setInterval(() => pollAnalysis(serial), 900);
        } else applyResult(job.result);
      } else if (tab?.url && /^https?:/i.test(tab.url)) $('urlInput').value = tab.url;
    }
    await Promise.all([updateDownloadStatus(), updateAudioStatus()]);
  } catch (error) { setStatus('读取当前页面失败：' + error.message, 'error'); }
})();
