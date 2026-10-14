(() => {
  'use strict';

  const SAMPLE = 'https://weixin.qq.com/sph/AJECiyCANW';
  const STAGES = ['input', 'browser', 'session', 'source', 'transfer', 'verify'];
  const STAGE_LABELS = { input: '解析链接', browser: '打开页面', session: '确认会话', source: '获取内容', transfer: '下载文件', verify: '验证文件' };
  const PLATFORM_LABELS = { douyin: '抖音', channels: '微信视频号', wechat: '微信视频号', weixin: '微信视频号', wechat_channels: '微信视频号', xiaohongshu: '小红书', bilibili: 'B站', youtube: 'YouTube' };
  const LOGIN_LABELS = {
    channels: { heading: '腾讯登录', official: '腾讯官方登录', provider: '腾讯', dialog: '微信扫码登录', scan: '请使用微信扫描腾讯官方二维码登录。' },
    xiaohongshu: { heading: '小红书登录', official: '小红书官方登录', provider: '小红书', dialog: '小红书扫码登录', scan: '请使用小红书扫描官方二维码登录。' },
  };
  const STATE_LABELS = { queued: '排队中', running: '处理中', waiting: '等待登录', done: '已完成', error: '未完成', canceled: '已停止' };
  const TERMINAL = new Set(['done', 'error', 'canceled']);
  const el = (id) => document.getElementById(id);
  const dom = {
    form: el('extract-form'), input: el('share-input'), submit: el('extract-button'),
    clear: el('clear-input'), paste: el('paste-input'), sample: el('sample-input'),
    inputError: el('input-error'), platform: el('detected-platform'), jobActions: el('job-actions'),
    cancel: el('cancel-button'), retry: el('retry-button'), retryActions: el('retry-actions'),
    state: el('job-state'), message: el('current-message'), detail: el('progress-detail'), elapsed: el('elapsed-time'),
    transfer: el('transfer-section'), transferTitle: el('transfer-title'), bytes: el('transfer-bytes'), progress: el('transfer-progress'),
    error: el('task-error'), errorMessage: el('task-error-message'),
    result: el('result-section'), title: el('video-title'), resultPlatform: el('result-platform'),
    select: el('candidate-select'), candidateControl: el('candidate-control'), video: el('video-preview'),
    fallback: el('preview-fallback'), previewError: el('preview-error'), download: el('download-file'), downloadState: el('download-state'),
    size: el('file-size'), codec: el('file-codec'), duration: el('video-duration'), name: el('file-name'), source: el('source-link'),
    log: el('event-log'), logEmpty: el('log-empty'), count: el('event-count'), export: el('export-log'),
    login: el('login-section'), loginMessage: el('login-message'), shot: el('browser-shot'), shotPlaceholder: el('shot-placeholder'),
    qrDialog: el('qr-dialog'), qrImage: el('qr-dialog-image'), qrPlaceholder: el('qr-dialog-placeholder'), qrClose: el('qr-dialog-close'),
    refreshQr: el('refresh-qr'), dialogRefreshQr: el('dialog-refresh-qr'),
    browserMessage: el('browser-message'), browser: el('open-browser'), loginBrowser: el('login-browser'),
    logout: el('logout-session'),
    cancelLabel: el('cancel-label'), videoResult: el('video-result'), images: el('image-result'), imageList: el('image-list'), imageCount: el('image-count'), imageZip: el('download-images'),
    content: el('content-section'), contentText: el('content-text'), contentStatus: el('content-status'), contentCopy: el('copy-content'), contentSave: el('save-content'), downloadCancel: el('cancel-download'),
  };

  let activeJob = null;
  let jobId = null;
  let startedAt = null;
  let pollTimer = null;
  let pollingJobId = null;
  let requestedPollId = null;
  let resumingJob = false;
  let serverLastJobId = null;
  let screenshotTimer = null;
  let screenshotObjectUrl = null;
  let screenshotInFlight = false;
  let screenshotGeneration = 0;
  let screenshotController = null;
  let qrRefreshing = false;
  let qrExpired = false;
  let awaitingFreshQr = false;
  let requiredQrRefreshId = null;
  let submitting = false;
  let jobBusy = false;
  let renderedResultKey = null;
  let renderedEventKeys = new Set();
  let lastJobInput = SAMPLE;
  let serviceAvailable = false;
  let saving = false;
  const loginStates = { channels: { remembered: false, expiresAt: null }, xiaohongshu: { remembered: false, expiresAt: null } };
  let selectedLoginPlatform = 'channels';
  let loggingOut = false;
  let loginMetadataGeneration = 0;
  let statusRequestSequence = 0;
  let jobGeneration = 0;
  let submissionGeneration = null;
  let stopping = false;
  let cancellationError = null;
  let pollController = null;
  let downloadController = null;
  let downloadGeneration = 0;
  const imageObjectUrls = new Set();
  const imageControllers = new Set();

  function icons(root = document) {
    if (window.lucide?.createIcons) window.lucide.createIcons({ root, attrs: { 'aria-hidden': 'true' } });
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) data = await response.json();
    else { await response.text(); data = { error: `云端服务返回错误 (${response.status})` }; }
    if (!response.ok) {
      const failure = new Error(typeof data.error === 'string' ? data.error : data.message || `云端服务返回错误 (${response.status})`);
      failure.status = response.status;
      throw failure;
    }
    return data;
  }

  function formatBytes(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return '未知';
    if (number < 1024) return `${Math.round(number)} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let result = number / 1024;
    let index = 0;
    while (result >= 1024 && index < units.length - 1) { result /= 1024; index += 1; }
    return `${result.toFixed(result >= 100 ? 0 : 1)} ${units[index]}`;
  }

  function parseTime(value) {
    if (!value) return null;
    let stamp = typeof value === 'number' ? value : Date.parse(value);
    if (Number.isFinite(stamp) && stamp > 0 && stamp < 100000000000) stamp *= 1000;
    return Number.isFinite(stamp) ? stamp : null;
  }

  function formatClock(timestamp) {
    const parsed = parseTime(timestamp);
    return parsed ? new Date(parsed).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--';
  }

  function durationLabel(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '未知';
    const whole = Math.floor(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor(whole / 60) % 60;
    const remainder = whole % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
  }

  function updateElapsed() {
    if (!startedAt) { dom.elapsed.textContent = '00:00'; return; }
    const lastTime = TERMINAL.has(activeJob?.state) ? parseTime(activeJob.events?.at(-1)?.time) || Date.now() : Date.now();
    const seconds = Math.max(0, Math.floor((lastTime - startedAt) / 1000));
    dom.elapsed.textContent = seconds >= 3600 ? durationLabel(seconds) : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function detectPlatform() {
    const input = dom.input.value.trim();
    dom.platform.textContent = /weixin\.qq\.com|视频号/i.test(input) ? '微信视频号' : /douyin\.com|iesdouyin\.com|抖音/i.test(input) ? '抖音' : /xiaohongshu\.com|xhslink\.(?:com|cn)|小红书/i.test(input) ? '小红书' : /bilibili\.com|b23\.tv|B站/i.test(input) ? 'B站' : /youtube\.com|youtu\.be|YouTube/i.test(input) ? 'YouTube' : input ? '等待识别平台' : '未输入链接';
    selectedLoginPlatform = dom.platform.textContent === '小红书' ? 'xiaohongshu' : 'channels';
    renderCloudLoginState();
  }

  function storeInput() {
    try { localStorage.setItem('anma-share-input', dom.input.value); } catch { /* Local storage can be disabled by the browser. */ }
  }

  function rememberJob(id) {
    try {
      if (id) sessionStorage.setItem('anma-last-job', id);
      else sessionStorage.removeItem('anma-last-job');
    } catch { /* Session storage is optional. */ }
  }

  function rememberedJob() {
    try { return sessionStorage.getItem('anma-last-job'); } catch { return null; }
  }

  function setInputError(message) {
    dom.inputError.textContent = message;
    dom.inputError.hidden = !message;
    dom.input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function setBusy(busy) {
    jobBusy = busy;
    dom.input.disabled = busy;
    dom.clear.disabled = busy;
    dom.paste.disabled = busy;
    dom.sample.disabled = busy;
    dom.submit.disabled = busy || loggingOut;
    dom.submit.querySelector('span').textContent = busy ? '正在提取' : '开始提取';
    dom.jobActions.hidden = !busy;
    dom.cancel.disabled = !busy || stopping || !jobId;
    dom.cancelLabel.textContent = stopping ? '停止中' : '停止任务';
    renderCloudLoginState();
  }

  function setService(available, text) {
    serviceAvailable = available;
    const target = el('service-state');
    target.className = `service-state ${available ? 'online' : 'offline'}`;
    target.querySelector('span:last-child').textContent = text || (available ? '云端已连接' : '云端未连接');
    el('footer-status').textContent = available ? '云端服务已连接' : '云端服务未连接';
  }

  function renderEnvironment(status) {
    const version = status.version || '2.5.3-web';
    el('version').textContent = version;
    el('environment-version').textContent = version;
    const browser = status.browser;
    const available = status.ready !== false && browser !== false && browser?.available !== false;
    el('browser-detail').textContent = typeof browser === 'string' ? browser : browser?.name || browser?.browser || '独立云端会话';
    renderCloudLoginState(available);
  }

  function renderCloudLoginState(available = serviceAvailable) {
    const platform = currentLoginPlatform();
    const labels = LOGIN_LABELS[platform];
    const relevant = loginPlatformOf() === platform;
    const state = relevant ? activeJob?.state : null;
    const retained = hasRetainedLogin(platform);
    const reusing = state && !TERMINAL.has(state) && state !== 'waiting' && /复用/.test(activeJob?.events?.at(-1)?.message || '');
    el('browser-heading-label').textContent = labels.heading;
    el('browser-label').textContent = available ? labels.official : '云端浏览器未就绪';
    el('qr-dialog-title').textContent = labels.dialog;
    dom.shot.alt = `本次任务的${labels.official}画面`;
    dom.qrImage.alt = `${labels.official}页面的原始画面`;
    dom.logout.title = `退出${labels.provider}登录`;
    dom.logout.setAttribute('aria-label', dom.logout.title);
    if (dom.browserMessage.dataset.platform && dom.browserMessage.dataset.platform !== platform) dom.browserMessage.hidden = true;
    el('browser-state').hidden = !relevant && !retained && platform !== 'xiaohongshu';
    el('browser-state').textContent = !available ? '未就绪' : qrRefreshing ? '刷新中' : qrExpired && relevant ? '二维码已过期' : state === 'waiting' ? '等待扫码' : reusing ? '正在复用登录' : retained ? '登录已保留' : state === 'done' ? platform === 'channels' ? '已完成' : '未登录' : state === 'error' ? '未完成' : state === 'canceled' ? '已停止' : state ? '处理中' : '未登录';
    el('browser-state').className = `neutral-pill ${!available ? 'error' : state === 'waiting' ? '' : retained || reusing ? 'ready' : state === 'error' ? 'error' : state === 'done' && platform === 'channels' ? 'ready' : ''}`;
    dom.browser.hidden = !relevant;
    dom.browser.disabled = stopping || qrRefreshing || !relevant || !jobId || !state || TERMINAL.has(state);
    dom.logout.hidden = !retained;
    dom.logout.disabled = loggingOut || submitting || jobBusy || Boolean(state && !TERMINAL.has(state));
    updateQrControls();
  }

  function isChannelsJob(job = activeJob) {
    return ['channels', 'wechat', 'weixin', 'wechat_channels'].includes(job?.platform || job?.result?.platform);
  }

  function loginPlatformOf(job = activeJob) {
    if (isChannelsJob(job)) return 'channels';
    return ['xiaohongshu', 'xhs'].includes(job?.platform || job?.result?.platform) ? 'xiaohongshu' : null;
  }

  function currentLoginPlatform() {
    return activeJob && !TERMINAL.has(activeJob.state) ? loginPlatformOf() || 'channels' : selectedLoginPlatform;
  }

  function hasRetainedLogin(platform) {
    const state = loginStates[platform];
    return state.remembered && (!state.expiresAt || state.expiresAt > Date.now());
  }

  function needsOfficialLogin(job = activeJob) {
    return Boolean(loginPlatformOf(job) && job?.state === 'waiting' && latestLoginEvent(job));
  }

  function latestLoginEvent(job = activeJob) {
    const platform = loginPlatformOf(job);
    return [...(job?.events || [])].reverse().find(event => event.needsLogin &&
      (!event.loginPlatform || event.loginPlatform === platform) &&
      (!event.platform || loginPlatformOf({ platform: event.platform }) === platform));
  }

  function currentLoginRequest(id, platform) {
    return id === jobId && platform === loginPlatformOf() && !stopping;
  }

  function setBrowserMessage(platform, message, error = false) {
    dom.browserMessage.dataset.platform = platform;
    dom.browserMessage.hidden = currentLoginPlatform() !== platform;
    dom.browserMessage.className = `small-message${error ? ' error' : ''}`;
    dom.browserMessage.textContent = message;
  }

  function validateLoginResponse(data, platform) {
    if ((platform === 'xiaohongshu' || data.platform) && data.platform !== platform) throw new Error('官方登录画面与当前平台不匹配，请重新提取。');
  }

  async function checkStatus(resume = false) {
    const requestSequence = ++statusRequestSequence;
    const metadataGeneration = loginMetadataGeneration;
    try {
      const status = await api('/api/status');
      if (requestSequence !== statusRequestSequence) return;
      setService(true);
      if (!loggingOut && metadataGeneration === loginMetadataGeneration) {
        for (const platform of Object.keys(loginStates)) {
          const metadata = status.logins?.[platform] || (platform === 'channels' ? status.login : null);
          loginStates[platform] = { remembered: metadata?.remembered === true, expiresAt: parseTime(metadata?.expiresAt) };
        }
      }
      renderEnvironment(status);
      serverLastJobId = status.lastJobId || null;
      const previousJob = resume ? status.activeJobId || rememberedJob() || serverLastJobId : null;
      if (previousJob && !jobId && !submitting) {
        jobId = previousJob;
        rememberJob(jobId);
        resumingJob = true;
        startedAt = Date.now();
        setBusy(true);
        pollJob(jobId);
      }
    } catch {
      if (requestSequence !== statusRequestSequence) return;
      setService(false);
      el('browser-label').textContent = '云端服务未连接';
      el('browser-state').textContent = '离线';
      el('browser-state').className = 'neutral-pill error';
    }
  }

  function renderStages(job) {
    const currentIndex = STAGES.indexOf(job.stage);
    const done = job.state === 'done';
    document.querySelectorAll('#stages li').forEach((node, index) => {
      const complete = done || (currentIndex >= 0 && index < currentIndex);
      const current = !done && index === currentIndex;
      node.className = complete ? 'complete' : current ? `current${job.state === 'error' ? ' failed' : job.state === 'waiting' ? ' waiting' : ''}` : '';
      if (current) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
      const marker = node.querySelector('.stage-marker');
      const type = complete ? 'check' : current && job.state === 'error' ? 'x' : current && job.state === 'waiting' ? 'pause' : null;
      marker.replaceChildren();
      if (type) {
        const icon = document.createElement('i');
        icon.dataset.lucide = type;
        icon.setAttribute('aria-hidden', 'true');
        marker.append(icon);
      } else {
        const number = document.createElement('span');
        number.textContent = index + 1;
        marker.append(number);
      }
    });
    icons(el('stages'));
  }

  function safeDiagnostic(message) {
    return String(message || '').slice(0, 8192).replace(/https?:\/\/[^\s"'<>]+/gi, value => {
      try {
        const parsed = new URL(value);
        return `${parsed.origin}${parsed.pathname}`;
      } catch { return '[链接已隐藏]'; }
    });
  }

  function jobMessage(message, job = activeJob) {
    const diagnostic = safeDiagnostic(message);
    const isDouyin = (job?.platform || job?.result?.platform) === 'douyin' || /(?:douyin|iesdouyin)\.com/i.test(`${job?.inputUrl || ''} ${diagnostic}`);
    if (isDouyin && /page\.goto/i.test(diagnostic) && /timeout|timed?\s*out/i.test(diagnostic)) {
      return '抖音页面响应超时，未取得视频。请重新提取；若仍失败，请复制新的分享链接再试。';
    }
    return diagnostic;
  }

  function renderEvents(job) {
    const events = Array.isArray(job.events) ? job.events : [];
    const nearBottom = dom.log.scrollHeight - dom.log.scrollTop - dom.log.clientHeight < 48;
    events.forEach((event, index) => {
      const key = event.id == null ? `${index}:${event.time}:${event.message}` : String(event.id);
      if (renderedEventKeys.has(key)) return;
      renderedEventKeys.add(key);
      const row = document.createElement('li');
      if (job.state === 'error' && index === events.length - 1) row.className = 'log-error';
      const time = document.createElement('time');
      time.textContent = formatClock(event.time);
      const stamp = parseTime(event.time);
      if (stamp) time.dateTime = new Date(stamp).toISOString();
      const stage = document.createElement('span');
      stage.className = 'log-stage';
      stage.textContent = STAGE_LABELS[event.stage] || event.stage || '任务';
      const message = document.createElement('span');
      message.className = 'log-message';
      const diagnostic = safeDiagnostic(event.message);
      const description = jobMessage(event.message, job);
      message.textContent = description;
      if (description !== diagnostic) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = '查看诊断';
        const detail = document.createElement('span');
        detail.textContent = diagnostic;
        details.append(summary, detail);
        message.append(details);
      }
      row.append(time, stage, message);
      dom.log.append(row);
    });
    dom.count.textContent = events.length;
    dom.log.hidden = events.length === 0;
    dom.logEmpty.hidden = events.length !== 0;
    dom.export.disabled = events.length === 0;
    if (nearBottom) dom.log.scrollTop = dom.log.scrollHeight;
  }

  function renderTransfer(job) {
    const transferEvent = [...(job.events || [])].reverse().find((event) => event.stage === 'transfer' && (event.received != null || event.total != null));
    const received = Number(job.received ?? transferEvent?.received ?? 0);
    const total = Number(job.total ?? transferEvent?.total ?? 0);
    const show = job.stage === 'transfer' || received > 0;
    dom.transfer.hidden = !show;
    if (!show) return;
    const knownTotal = Number.isFinite(total) && total > 0;
    dom.bytes.textContent = `${formatBytes(received)}${knownTotal ? ` / ${formatBytes(total)}` : ''}`;
    if (knownTotal) { dom.progress.max = total; dom.progress.value = Math.max(0, Math.min(received, total)); }
    else { dom.progress.removeAttribute('value'); dom.progress.removeAttribute('max'); }
    dom.transferTitle.textContent = job.state === 'done' ? '下载完成' : job.stage === 'verify' ? '下载完成，正在验证' : job.state === 'error' ? '已接收' : job.state === 'canceled' ? '已停止下载' : knownTotal ? `正在下载 · ${Math.min(100, Math.floor(received / total * 100))}%` : '正在下载';
    if (TERMINAL.has(job.state) && !knownTotal) { dom.progress.max = 1; dom.progress.value = job.state === 'done' ? 1 : 0; }
  }

  function safeLocalFile(url) {
    if (typeof url !== 'string') return null;
    try {
      const parsed = new URL(url, location.origin);
      return parsed.origin === location.origin && parsed.pathname.startsWith('/api/files/') ? parsed.href : null;
    } catch { return null; }
  }

  function safeSource(url) {
    try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; }
  }

  function resultContent(result) {
    const candidates = Array.isArray(result?.candidates) ? result.candidates.filter(candidate => candidate && typeof candidate === 'object') : [];
    const contentText = typeof result?.contentText === 'string' ? result.contentText : '';
    const hasFiles = candidates.some(candidate => safeLocalFile(candidate.imageUrl || candidate.videoUrl || candidate.downloadUrl));
    return { candidates, contentText, hasFiles, hasContent: hasFiles || Boolean(contentText.trim()) };
  }

  function showCandidate(index) {
    const result = activeJob?.result;
    const candidate = result?.candidates?.[index];
    if (!candidate) return;
    dom.previewError.hidden = true;
    dom.fallback.hidden = true;
    dom.video.hidden = false;
    dom.video.pause();
    dom.video.removeAttribute('src');
    dom.duration.textContent = candidate.duration ? durationLabel(Number(candidate.duration)) : '读取中';
    const videoUrl = safeLocalFile(candidate.videoUrl);
    if (videoUrl) { dom.video.src = videoUrl; dom.video.load(); }
    else {
      dom.video.hidden = true;
      dom.fallback.hidden = false;
      dom.previewError.hidden = false;
      dom.previewError.textContent = '未获得可预览的视频地址。';
      dom.duration.textContent = '未知';
    }
    const downloadUrl = safeLocalFile(candidate.downloadUrl || candidate.videoUrl);
    dom.download.hidden = !downloadUrl;
    if (downloadUrl) dom.download.href = downloadUrl;
    dom.download.download = candidate.fileName || 'video.mp4';
    dom.size.textContent = formatBytes(candidate.bytes);
    dom.codec.textContent = candidate.codec || candidate.format || candidate.contentType?.replace('video/', '') || 'MP4';
    dom.name.textContent = candidate.fileName || 'video.mp4';
    dom.name.title = candidate.fileName || 'video.mp4';
    dom.title.textContent = result.title || candidate.title || '提取的视频';
  }

  function renderResult(job) {
    if (job.state !== 'done') return;
    const result = job.result || {};
    const { candidates, contentText, hasFiles, hasContent } = resultContent(result);
    const resultKey = JSON.stringify([job.id, result.title, result.platform, result.pageUrl, result.verifiedFile, contentText, candidates]);
    if (renderedResultKey === resultKey) return;
    renderedResultKey = resultKey;
    resetDownload();
    dom.result.hidden = !hasContent;
    if (dom.result.hidden) {
      dom.video.pause();
      dom.video.removeAttribute('src');
      dom.imageList.replaceChildren();
      dom.images.hidden = true;
      dom.content.hidden = true;
      el('verified-badge').hidden = true;
      dom.error.hidden = false;
      dom.errorMessage.textContent = '任务已结束，但未返回可保存的内容。请导出处理记录查看详细结果。';
      return;
    }
    el('verified-badge').hidden = result.verifiedFile !== true || !hasFiles;
    dom.resultPlatform.textContent = PLATFORM_LABELS[result.platform] || result.platform || '内容';
    dom.title.textContent = result.title || '提取的内容';
    const sourceUrl = safeSource(result.pageUrl);
    dom.source.hidden = !sourceUrl;
    if (sourceUrl) dom.source.href = sourceUrl;
    dom.select.replaceChildren();
    const videos = [];
    const images = [];
    candidates.forEach((candidate, index) => {
      if (candidate.kind === 'image') { images.push({ candidate, index }); return; }
      videos.push({ candidate, index });
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${index + 1}. ${candidate.title || candidate.fileName || '视频'} · ${formatBytes(candidate.bytes)}`;
      dom.select.append(option);
    });
    dom.candidateControl.hidden = videos.length < 2;
    dom.videoResult.hidden = videos.length === 0;
    if (videos.length) { dom.select.value = String(videos[0].index); showCandidate(videos[0].index); }
    else { dom.video.pause(); dom.video.removeAttribute('src'); dom.name.textContent = `${images.length} 张图片`; }
    dom.images.hidden = images.length === 0;
    dom.imageCount.textContent = images.length;
    dom.imageList.replaceChildren();
    images.forEach(({ candidate, index }, ordinal) => renderImage(candidate, index, ordinal));
    dom.content.hidden = !contentText.trim();
    dom.contentText.textContent = contentText;
    dom.contentStatus.hidden = true;
    setDownloadControls();
    icons(dom.result);
  }

  function renderImage(candidate, index, ordinal) {
    const row = document.createElement('li');
    row.className = 'image-item';
    const link = document.createElement('a');
    link.className = 'image-open';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `查看第 ${ordinal + 1} 张原图`);
    const img = document.createElement('img');
    img.alt = `第 ${ordinal + 1} 张图片`;
    img.loading = 'lazy';
    const source = safeLocalFile(candidate.imageUrl || candidate.videoUrl);
    if (source) link.href = source;
    const notice = document.createElement('span');
    notice.className = 'image-preview-error';
    notice.textContent = '图片预览未能加载';
    notice.hidden = true;
    img.addEventListener('error', () => { notice.hidden = false; img.hidden = true; });
    link.append(img, notice);
    const footer = document.createElement('div');
    footer.className = 'image-item-footer';
    const caption = document.createElement('span');
    caption.textContent = `${ordinal + 1} · ${(candidate.format || '图片').toUpperCase()} · ${formatBytes(candidate.bytes)}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button image-save';
    button.dataset.fileAvailable = String(Boolean(source));
    button.setAttribute('aria-label', `保存第 ${ordinal + 1} 张图片`);
    button.disabled = saving || !source;
    const icon = document.createElement('i');
    icon.dataset.lucide = 'download';
    button.append(icon, document.createTextNode('保存'));
    button.addEventListener('click', () => saveFiles([index]));
    footer.append(caption, button);
    row.append(link, footer);
    dom.imageList.append(row);
    if (!source) { notice.hidden = false; img.hidden = true; return; }
    if (Number(candidate.bytes) <= 4 * 1024 * 1024) { img.src = source; return; }
    const controller = new AbortController();
    const generation = jobGeneration;
    imageControllers.add(controller);
    readCandidate(candidate, controller.signal).then(blob => {
      if (generation !== jobGeneration || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      imageObjectUrls.add(url);
      img.src = url;
      link.href = url;
    }).catch(error => {
      if (error.name !== 'AbortError' && generation === jobGeneration) { notice.hidden = false; img.hidden = true; }
    }).finally(() => imageControllers.delete(controller));
  }

  function clearScreenshotImages(closeDialog = false) {
    clearTimeout(screenshotTimer);
    screenshotTimer = null;
    screenshotGeneration += 1;
    screenshotController?.abort();
    screenshotController = null;
    const previous = screenshotObjectUrl;
    dom.shot.removeAttribute('src');
    dom.qrImage.removeAttribute('src');
    dom.qrImage.hidden = true;
    dom.qrPlaceholder.hidden = false;
    if (closeDialog) closeQrDialog();
    if (previous) URL.revokeObjectURL(previous);
    screenshotObjectUrl = null;
    dom.shot.hidden = true;
    dom.shotPlaceholder.hidden = false;
  }

  function stopScreenshots() {
    qrRefreshing = false;
    qrExpired = false;
    awaitingFreshQr = false;
    clearScreenshotImages(true);
    renderCloudLoginState();
  }

  function setScreenshotPlaceholder(message) {
    dom.shotPlaceholder.textContent = message;
    dom.qrPlaceholder.textContent = message;
  }

  function updateQrControls() {
    const disabled = stopping || qrRefreshing || !jobId || !needsOfficialLogin();
    dom.refreshQr.disabled = disabled;
    dom.dialogRefreshQr.disabled = disabled;
    dom.loginBrowser.disabled = disabled;
  }

  async function updateScreenshot() {
    if (dom.login.hidden || !needsOfficialLogin() || screenshotInFlight || qrRefreshing || qrExpired) return;
    clearTimeout(screenshotTimer);
    screenshotTimer = null;
    screenshotInFlight = true;
    const generation = screenshotGeneration;
    const currentShotJob = jobId;
    const currentShotPlatform = loginPlatformOf();
    const controller = new AbortController();
    screenshotController = controller;
    try {
      const refreshQuery = requiredQrRefreshId ? `&refreshId=${encodeURIComponent(requiredQrRefreshId)}` : '';
      const response = await fetch(`/api/browser-shot?job=${encodeURIComponent(currentShotJob)}${refreshQuery}`, { cache: 'no-store', signal: controller.signal });
      if (!dom.login.hidden && response.ok && response.status !== 204 && response.headers.get('content-type')?.startsWith('image/')) {
        const blob = await response.blob();
        if (!dom.login.hidden && needsOfficialLogin() && currentLoginRequest(currentShotJob, currentShotPlatform) && generation === screenshotGeneration && !qrRefreshing && !qrExpired) {
          const previous = screenshotObjectUrl;
          screenshotObjectUrl = URL.createObjectURL(blob);
          dom.shot.src = screenshotObjectUrl;
          dom.qrImage.src = screenshotObjectUrl;
          dom.qrImage.hidden = false;
          dom.qrPlaceholder.hidden = true;
          dom.shot.hidden = false;
          dom.shotPlaceholder.hidden = true;
          if (awaitingFreshQr) {
            awaitingFreshQr = false;
            setBrowserMessage(currentShotPlatform, '官方登录画面已更新');
          }
          if (previous) URL.revokeObjectURL(previous);
        }
      } else if (!dom.login.hidden && dom.shot.hidden && currentLoginRequest(currentShotJob, currentShotPlatform) && generation === screenshotGeneration && !qrRefreshing && !qrExpired) {
        setScreenshotPlaceholder(awaitingFreshQr ? '正在等待新的官方二维码' : '官方登录画面尚未就绪，正在等待');
      }
    } catch (error) {
      if (error.name !== 'AbortError' && !dom.login.hidden && dom.shot.hidden && currentLoginRequest(currentShotJob, currentShotPlatform) && generation === screenshotGeneration && !qrRefreshing && !qrExpired) setScreenshotPlaceholder('暂时无法读取官方登录画面');
    } finally {
      screenshotInFlight = false;
      if (screenshotController === controller) screenshotController = null;
      if (!dom.login.hidden && needsOfficialLogin() && !stopping && !qrRefreshing && !qrExpired) screenshotTimer = setTimeout(updateScreenshot, 2500);
    }
  }

  function showQrDialog() {
    if (!jobId || !needsOfficialLogin() || stopping || dom.login.hidden) return;
    if (screenshotObjectUrl) {
      dom.qrImage.src = screenshotObjectUrl;
      dom.qrImage.hidden = false;
      dom.qrPlaceholder.hidden = true;
    } else {
      dom.qrImage.hidden = true;
      dom.qrPlaceholder.hidden = false;
    }
    if (!dom.qrDialog.open) {
      dom.qrDialog.showModal();
      document.body.classList.add('has-qr-dialog');
    }
  }

  function closeQrDialog() {
    if (dom.qrDialog.open) dom.qrDialog.close();
    document.body.classList.remove('has-qr-dialog');
  }

  function renderLogin(job) {
    const loginEvent = latestLoginEvent(job);
    const needed = needsOfficialLogin(job);
    const wasHidden = dom.login.hidden;
    dom.login.hidden = !needed;
    if (needed) {
      const labels = LOGIN_LABELS[loginPlatformOf(job)];
      el('login-heading').textContent = `等待${labels.heading}`;
      dom.loginMessage.textContent = loginEvent.message || labels.scan;
      let becameReady = false;
      if (loginPlatformOf(job) === 'xiaohongshu') {
        if (loginEvent.qrExpired === true && !qrExpired) {
          qrExpired = true;
          awaitingFreshQr = false;
          clearScreenshotImages();
          setScreenshotPlaceholder('二维码已过期，请刷新二维码');
          setBrowserMessage('xiaohongshu', '二维码已过期，请刷新二维码');
          renderCloudLoginState();
        } else if (loginEvent.qrReady === true && loginEvent.qrExpired !== true && qrExpired) {
          qrExpired = false;
          becameReady = true;
          renderCloudLoginState();
        }
      }
      if ((wasHidden || becameReady) && !qrExpired) { setScreenshotPlaceholder('正在读取官方登录画面'); updateScreenshot(); }
    } else if (!wasHidden) stopScreenshots();
    updateQrControls();
  }

  function renderJob(job) {
    const previousState = activeJob?.state;
    activeJob = job;
    if (TERMINAL.has(job.state)) cancellationError = null;
    if (job.inputUrl) {
      lastJobInput = job.inputUrl;
      if (resumingJob) { dom.input.value = job.inputUrl; detectPlatform(); resumingJob = false; }
    }
    selectedLoginPlatform = loginPlatformOf(job) || 'channels';
    if (job.loginRemembered === true && loginPlatformOf(job) && !hasRetainedLogin(loginPlatformOf(job))) {
      loginMetadataGeneration += 1;
      loginStates[loginPlatformOf(job)] = { remembered: true, expiresAt: null };
    }
    if (job.events?.length && parseTime(job.events[0].time)) startedAt = parseTime(job.events[0].time);
    const completedContent = resultContent(job.result);
    const emptyDone = job.state === 'done' && !completedContent.hasContent;
    const visibleJob = emptyDone ? { ...job, state: 'error', error: '任务已结束，但未返回可保存的内容。请重新提取或导出处理记录查看详细结果。' } : job;
    const busy = !TERMINAL.has(job.state);
    setBusy(busy);
    dom.state.textContent = STATE_LABELS[visibleJob.state] || visibleJob.state || '处理中';
    dom.state.className = `state-badge ${visibleJob.state}`;
    const lastEvent = job.events?.at(-1);
    const doneMessage = completedContent.hasFiles ? job.result?.verifiedFile === true ? '内容已提取，文件已验证' : '内容已提取，文件尚未验证' : '文案已提取';
    dom.message.textContent = emptyDone ? '未取得可保存的内容' : job.state === 'done' ? doneMessage : job.state === 'canceled' ? '任务已停止' : jobMessage(lastEvent?.message, job) || (job.state === 'queued' ? '等待云端服务处理' : '正在处理内容');
    dom.detail.textContent = `${STAGE_LABELS[job.stage] || '准备处理'} · 任务 ${String(job.id || jobId).slice(0, 8)}`;
    dom.error.hidden = visibleJob.state !== 'error' && !cancellationError;
    if (visibleJob.state === 'error') dom.errorMessage.textContent = jobMessage(typeof visibleJob.error === 'string' ? visibleJob.error : visibleJob.error?.message || lastEvent?.message, job) || '提取失败，请查看处理记录。';
    else if (cancellationError) dom.errorMessage.textContent = cancellationError;
    dom.retryActions.hidden = !['error', 'canceled'].includes(visibleJob.state);
    renderStages(visibleJob);
    renderEvents(job);
    renderTransfer(visibleJob);
    renderLogin(job);
    renderResult(job);
    updateElapsed();
    if (job.state === 'done' && previousState !== 'done') checkStatus();
  }

  async function pollJob(id) {
    clearTimeout(pollTimer);
    if (id !== jobId || stopping) return;
    if (pollingJobId) { requestedPollId = id; return; }
    pollingJobId = id;
    const generation = jobGeneration;
    const controller = new AbortController();
    pollController = controller;
    let nextDelay = null;
    try {
      const job = await api(`/api/jobs/${encodeURIComponent(id)}`, { signal: controller.signal });
      if (id !== jobId || generation !== jobGeneration || stopping) return;
      setService(true);
      renderJob(job);
      if (!TERMINAL.has(job.state)) nextDelay = 700;
    } catch (error) {
      if (id !== jobId || generation !== jobGeneration || stopping || error.name === 'AbortError') return;
      if ([401, 403, 404, 410].includes(error.status)) {
        rememberJob(null);
        if (error.status === 404 && serverLastJobId && serverLastJobId !== id) {
          jobId = serverLastJobId;
          rememberJob(jobId);
          resumingJob = true;
          requestedPollId = jobId;
          return;
        }
        jobId = null;
        activeJob = null;
        resumingJob = false;
        startedAt = null;
        setBusy(false);
        dom.state.textContent = '待开始';
        dom.state.className = 'state-badge';
        dom.message.textContent = '上次任务已过期';
        dom.detail.textContent = [401, 403].includes(error.status) ? '云端会话已过期，请重新提取' : '云端任务已清理，请重新提取';
        dom.login.hidden = true;
        stopScreenshots();
        renderCloudLoginState();
        updateElapsed();
        return;
      }
      setService(false, '连接中断');
      dom.message.textContent = '等待恢复云端服务连接';
      dom.detail.textContent = jobMessage(error.message);
      nextDelay = 1800;
    } finally {
      pollingJobId = null;
      if (pollController === controller) pollController = null;
      const requested = requestedPollId;
      requestedPollId = null;
      if (!stopping && requested && requested === jobId && !TERMINAL.has(activeJob?.state)) pollJob(requested);
      else if (!stopping && id === jobId && generation === jobGeneration && nextDelay != null) pollTimer = setTimeout(() => pollJob(id), nextDelay);
    }
  }

  function resetJobView() {
    clearTimeout(pollTimer);
    pollController?.abort();
    requestedPollId = null;
    resetDownload();
    stopScreenshots();
    activeJob = null;
    cancellationError = null;
    requiredQrRefreshId = null;
    renderedResultKey = null;
    renderedEventKeys = new Set();
    dom.result.hidden = true;
    dom.downloadState.hidden = true;
    dom.video.pause();
    dom.video.removeAttribute('src');
    dom.video.load();
    dom.error.hidden = true;
    dom.retryActions.hidden = true;
    dom.transfer.hidden = true;
    dom.login.hidden = true;
    dom.imageList.replaceChildren();
    dom.images.hidden = true;
    dom.content.hidden = true;
    dom.contentStatus.hidden = true;
    dom.log.replaceChildren();
    dom.log.hidden = true;
    dom.logEmpty.hidden = false;
    dom.count.textContent = '0';
    dom.export.disabled = true;
    dom.state.textContent = '提交中';
    dom.state.className = 'state-badge running';
    dom.message.textContent = '正在创建提取任务';
    dom.detail.textContent = '连接云端服务';
    renderStages({ state: 'queued', stage: '' });
  }

  async function startJob() {
    if (submitting || stopping || loggingOut || (activeJob && !TERMINAL.has(activeJob.state))) return;
    const input = dom.input.value.trim();
    if (!input) { setInputError('请先输入内容分享链接。'); dom.input.focus(); return; }
    if (!/https?:\/\/\S+/i.test(input)) { setInputError('未找到有效的分享链接，请粘贴完整的分享内容。'); dom.input.focus(); return; }
    setInputError('');
    lastJobInput = input;
    storeInput();
    submitting = true;
    const generation = ++jobGeneration;
    submissionGeneration = generation;
    jobId = null;
    resumingJob = false;
    startedAt = Date.now();
    resetJobView();
    setBusy(true);
    dom.cancel.disabled = true;
    try {
      const data = await api('/api/jobs', { method: 'POST', body: JSON.stringify({ input }) });
      if (generation !== jobGeneration) return;
      if (!data.jobId) throw new Error('云端服务未返回任务编号。');
      jobId = data.jobId;
      rememberJob(jobId);
      dom.cancel.disabled = false;
      if (data.startUrl) await dispatchExtraction(data.startUrl);
      if (generation !== jobGeneration || stopping) return;
      setService(true);
      dom.cancel.disabled = false;
      pollJob(jobId);
    } catch (error) {
      if (generation !== jobGeneration) return;
      if (jobId) {
        try { await api(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }); } catch { /* The job may have already expired. */ }
        rememberJob(null);
        jobId = null;
      }
      setBusy(false);
      dom.state.textContent = '未完成';
      dom.state.className = 'state-badge error';
      dom.message.textContent = '任务创建失败';
      dom.detail.textContent = '尚未开始提取';
      dom.error.hidden = false;
      dom.errorMessage.textContent = jobMessage(error.message, { inputUrl: input });
      dom.retryActions.hidden = false;
      startedAt = null;
      updateElapsed();
      checkStatus();
    } finally {
      if (submissionGeneration === generation) { submitting = false; submissionGeneration = null; renderCloudLoginState(); }
    }
  }

  async function cancelJob() {
    if (!jobId || stopping || TERMINAL.has(activeJob?.state)) return;
    const id = jobId;
    const generation = ++jobGeneration;
    stopping = true;
    cancellationError = null;
    clearTimeout(pollTimer);
    requestedPollId = null;
    pollController?.abort();
    stopScreenshots();
    dom.login.hidden = true;
    setBusy(true);
    dom.state.textContent = '停止中';
    dom.state.className = 'state-badge waiting';
    dom.message.textContent = '正在停止提取任务';
    dom.detail.textContent = '等待云端确认';
    dom.error.hidden = true;
    try {
      const data = await api(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      if (id !== jobId || generation !== jobGeneration) return;
      if (!data.job && data.canceled !== true) throw new Error('云端未确认停止，请重试。');
      const canceled = data.job || { ...activeJob, id, state: 'canceled', events: [...(activeJob?.events || []), { id: `cancel-${generation}`, time: new Date().toISOString(), stage: activeJob?.stage || 'input', message: '任务已停止。' }] };
      if (!TERMINAL.has(canceled.state)) throw new Error('云端尚未完成停止，请重试。');
      stopping = false;
      submitting = false;
      submissionGeneration = null;
      renderJob(canceled);
    } catch (error) {
      if (id !== jobId || generation !== jobGeneration) return;
      stopping = false;
      submitting = false;
      submissionGeneration = null;
      setBusy(true);
      dom.error.hidden = false;
      cancellationError = `停止任务失败：${error.message}`;
      dom.errorMessage.textContent = cancellationError;
      dom.message.textContent = '停止未获确认，可重试停止';
      pollJob(id);
    }
  }

  async function dispatchExtraction(startUrl) {
    let target;
    try { target = new URL(startUrl, location.origin); } catch { throw new Error('云端启动地址无效，请重新提取。'); }
    const allowedPaths = ['/.netlify/functions/extract-background', '/.netlify/functions/platform-background'];
    if (target.origin !== location.origin || !allowedPaths.includes(target.pathname) || target.username || target.password || target.hash || target.href.includes('#')) {
      throw new Error('云端启动地址无效，请重新提取。');
    }
    try {
      const response = await fetch(target.href, { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`云端提取启动失败 (${response.status})，请重新提取。`);
    } catch (error) {
      throw new Error(error.message.startsWith('云端提取启动失败') ? error.message : '无法启动云端提取，请检查网络后重新提取。');
    }
  }

  async function openBrowser() {
    const platform = loginPlatformOf();
    if (!jobId || !platform || stopping || TERMINAL.has(activeJob?.state)) return;
    const requestJobId = jobId;
    const generation = jobGeneration;
    dom.browser.disabled = true;
    dom.loginBrowser.disabled = true;
    setBrowserMessage(platform, `正在读取${LOGIN_LABELS[platform].official}画面`);
    try {
      const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ jobId: requestJobId }) });
      if (generation !== jobGeneration || !currentLoginRequest(requestJobId, platform)) return;
      validateLoginResponse(data, platform);
      setBrowserMessage(platform, qrExpired ? '二维码已过期，请刷新二维码' : data.opened ? '官方登录画面已就绪' : data.message || '正在等待官方登录画面');
      if (!dom.login.hidden) { showQrDialog(); await updateScreenshot(); }
      checkStatus();
    } catch (error) {
      if (generation === jobGeneration && currentLoginRequest(requestJobId, platform)) setBrowserMessage(platform, error.message, true);
    }
    finally { renderCloudLoginState(); }
  }

  async function logoutSession() {
    const platform = currentLoginPlatform();
    if (loggingOut || submitting || jobBusy || !hasRetainedLogin(platform) || (activeJob && !TERMINAL.has(activeJob.state))) return;
    loggingOut = true;
    loginMetadataGeneration += 1;
    dom.submit.disabled = true;
    renderCloudLoginState();
    setBrowserMessage(platform, `正在退出本网站的${LOGIN_LABELS[platform].provider}登录`);
    try {
      const data = await api('/api/logout', { method: 'POST', body: JSON.stringify(platform === 'xiaohongshu' ? { platform } : {}) });
      if (data.loggedOut !== true) throw new Error('网站未确认退出登录，请重试。');
      loginMetadataGeneration += 1;
      loginStates[platform] = { remembered: false, expiresAt: null };
      setBrowserMessage(platform, '已退出本网站的登录，下次提取需要扫码。');
    } catch (error) {
      setBrowserMessage(platform, `退出登录失败：${error.message}`, true);
    } finally {
      loggingOut = false;
      dom.submit.disabled = submitting || Boolean(activeJob && !TERMINAL.has(activeJob.state));
      renderCloudLoginState();
    }
  }

  async function refreshQr() {
    if (stopping || qrRefreshing || !jobId || !needsOfficialLogin()) return;
    const refreshJobId = jobId;
    const platform = loginPlatformOf();
    qrRefreshing = true;
    awaitingFreshQr = true;
    clearScreenshotImages();
    const generation = screenshotGeneration;
    updateQrControls();
    dom.browser.disabled = true;
    setScreenshotPlaceholder('正在刷新二维码');
    setBrowserMessage(platform, `正在刷新${LOGIN_LABELS[platform].provider}官方二维码`);
    try {
      const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ jobId: refreshJobId, refresh: true }) });
      if (generation !== screenshotGeneration || !currentLoginRequest(refreshJobId, platform) || !needsOfficialLogin()) return;
      validateLoginResponse(data, platform);
      requiredQrRefreshId = typeof data.refreshId === 'string' && data.refreshId ? data.refreshId : null;
      setBrowserMessage(platform, data.message || `正在等待新的${LOGIN_LABELS[platform].provider}官方二维码`);
      setScreenshotPlaceholder('正在等待新的官方二维码');
    } catch (error) {
      if (generation !== screenshotGeneration || !currentLoginRequest(refreshJobId, platform) || !needsOfficialLogin()) return;
      awaitingFreshQr = false;
      setBrowserMessage(platform, `二维码刷新失败：${error.message}`, true);
      setScreenshotPlaceholder('二维码刷新失败，请重试');
    } finally {
      if (generation === screenshotGeneration && currentLoginRequest(refreshJobId, platform)) {
        qrRefreshing = false;
        renderCloudLoginState();
        if (!dom.login.hidden && needsOfficialLogin()) updateScreenshot();
      }
    }
  }

  function downloadLabel(text) {
    const icon = document.createElement('i');
    icon.dataset.lucide = 'download';
    icon.setAttribute('aria-hidden', 'true');
    dom.download.replaceChildren(icon, document.createTextNode(text));
    icons(dom.download);
  }

  function setDownloadControls() {
    if (saving) dom.download.setAttribute('aria-disabled', 'true');
    else dom.download.removeAttribute('aria-disabled');
    dom.imageZip.disabled = saving;
    dom.imageList.querySelectorAll('button').forEach(button => { button.disabled = saving || button.dataset.fileAvailable !== 'true'; });
    dom.downloadCancel.hidden = !saving;
    dom.downloadCancel.disabled = false;
  }

  function resetDownload() {
    downloadGeneration += 1;
    downloadController?.abort();
    downloadController = null;
    saving = false;
    imageControllers.forEach(controller => controller.abort());
    imageControllers.clear();
    imageObjectUrls.forEach(url => URL.revokeObjectURL(url));
    imageObjectUrls.clear();
    setDownloadControls();
    downloadLabel('保存视频');
  }

  function fileSize(candidate) {
    const bytes = Number(candidate?.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 512 * 1024 * 1024) throw new Error('文件信息无效或超过 512 MB，请重新提取。');
    return bytes;
  }

  async function readCandidate(candidate, signal, onProgress = () => {}) {
    const source = safeLocalFile(candidate?.imageUrl || candidate?.videoUrl || candidate?.downloadUrl);
    if (!source) throw new Error('没有取得可保存的文件地址。');
    const total = fileSize(candidate);
    const parts = [];
    let received = 0;
    while (received < total) {
      signal.throwIfAborted();
      const end = Math.min(received + 4 * 1024 * 1024 - 1, total - 1);
      const response = await fetch(source, { headers: { Range: `bytes=${received}-${end}` }, credentials: 'same-origin', cache: 'no-store', signal });
      signal.throwIfAborted();
      if ([401, 403, 404, 410].includes(response.status)) throw new Error('云端文件或会话已过期，请重新提取。');
      if (response.status !== 206) throw new Error(`文件分段读取失败 (${response.status})，请重新保存。`);
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get('content-range') || '');
      if (!range || Number(range[1]) !== received || Number(range[2]) !== end || Number(range[3]) !== total) throw new Error('文件分段信息不匹配，已停止保存。请重新提取。');
      const part = await response.arrayBuffer();
      signal.throwIfAborted();
      if (part.byteLength !== end - received + 1) throw new Error('文件分段未完整接收，请检查网络后重新保存。');
      parts.push(part);
      received += part.byteLength;
      onProgress(received, total);
    }
    const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm' };
    const blob = new Blob(parts, { type: types[candidate.format] || (candidate.kind === 'image' ? 'application/octet-stream' : 'video/mp4') });
    if (blob.size !== total) throw new Error('文件大小不匹配，已停止保存。');
    return blob;
  }

  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function archiveName(value) {
    return String(value || '内容').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100) || '内容';
  }

  async function saveFiles(indexes, zip = false) {
    if (saving || activeJob?.state !== 'done') return;
    const saveJob = activeJob;
    const candidates = indexes.map(index => saveJob.result?.candidates?.[index]);
    const operation = ++downloadGeneration;
    const controller = new AbortController();
    downloadController = controller;
    saving = true;
    setDownloadControls();
    downloadLabel('正在保存');
    dom.downloadState.hidden = false;
    dom.downloadState.className = 'small-message';
    const current = () => operation === downloadGeneration && activeJob?.id === saveJob.id;
    try {
      if (!candidates.length) throw new Error('没有可保存的文件。');
      const total = candidates.reduce((sum, candidate) => sum + fileSize(candidate), 0);
      if (total > 512 * 1024 * 1024) throw new Error('文件总大小超过 512 MB，请逐张保存。');
      if (zip && !window.JSZip) throw new Error('打包模块未加载，请刷新网页后重试。');
      const archive = zip ? new window.JSZip() : null;
      let completed = 0;
      let single;
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        const label = candidate.kind === 'image' ? `图片 ${index + 1}/${candidates.length}` : '视频';
        if (current()) dom.downloadState.textContent = `正在接收${label} · ${formatBytes(completed)} / ${formatBytes(total)}`;
        const blob = await readCandidate(candidate, controller.signal, received => {
          if (current()) dom.downloadState.textContent = `正在接收${label} · ${formatBytes(completed + received)} / ${formatBytes(total)} · ${Math.floor((completed + received) / total * 100)}%`;
        });
        controller.signal.throwIfAborted();
        completed += blob.size;
        if (archive) archive.file(`${String(index + 1).padStart(2, '0')}_${archiveName(candidate.fileName || `image.${candidate.format || 'jpg'}`)}`, await blob.arrayBuffer());
        else single = blob;
      }
      let output = single;
      let fileName = candidates[0].fileName || (candidates[0].kind === 'image' ? `image.${candidates[0].format || 'jpg'}` : `video.${candidates[0].format || 'mp4'}`);
      if (archive) {
        if (saveJob.result.contentText) archive.file('文案.txt', saveJob.result.contentText);
        output = await archive.generateAsync({ type: 'blob', compression: 'STORE' }, metadata => {
          controller.signal.throwIfAborted();
          if (current()) dom.downloadState.textContent = `正在打包图片 · ${Math.floor(metadata.percent)}%`;
        });
        fileName = `${archiveName(saveJob.result.title)}.zip`;
      }
      controller.signal.throwIfAborted();
      if (!current()) return;
      triggerDownload(output, fileName);
      dom.downloadState.textContent = `完整文件已接收，保存已发起 · ${formatBytes(output.size)}`;
    } catch (error) {
      if (current()) {
        dom.downloadState.className = error.name === 'AbortError' ? 'small-message' : 'small-message error';
        dom.downloadState.textContent = error.name === 'AbortError' ? '已停止保存' : error instanceof TypeError ? '网络连接中断，请检查网络后重新保存。' : error.message;
      }
    } finally {
      if (operation === downloadGeneration) {
        saving = false;
        downloadController = null;
        setDownloadControls();
        downloadLabel('保存视频');
      }
    }
  }

  function saveVideo() { return saveFiles([Number(dom.select.value || 0)]); }

  function saveContent() {
    const text = activeJob?.result?.contentText;
    if (typeof text !== 'string' || !text) return;
    triggerDownload(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${archiveName(activeJob.result.title)}.txt`);
    dom.contentStatus.className = 'small-message';
    dom.contentStatus.textContent = '文案保存已发起';
    dom.contentStatus.hidden = false;
  }

  async function copyContent() {
    const text = activeJob?.result?.contentText;
    const generation = jobGeneration;
    if (typeof text !== 'string' || !text) return;
    try { await navigator.clipboard.writeText(text); if (generation === jobGeneration) dom.contentStatus.textContent = '文案已复制'; }
    catch { if (generation === jobGeneration) dom.contentStatus.textContent = '暂时无法复制，请选择文案后复制。'; }
    if (generation === jobGeneration) { dom.contentStatus.className = 'small-message'; dom.contentStatus.hidden = false; }
  }

  dom.form.addEventListener('submit', (event) => { event.preventDefault(); startJob(); });
  dom.input.addEventListener('input', () => { detectPlatform(); setInputError(''); storeInput(); });
  dom.clear.addEventListener('click', () => { dom.input.value = ''; detectPlatform(); storeInput(); setInputError(''); dom.input.focus(); });
  dom.sample.addEventListener('click', () => { dom.input.value = SAMPLE; detectPlatform(); storeInput(); setInputError(''); dom.input.focus(); });
  dom.paste.addEventListener('click', async () => {
    try { dom.input.value = await navigator.clipboard.readText(); detectPlatform(); storeInput(); setInputError(''); dom.input.focus(); }
    catch { setInputError('浏览器未允许读取剪贴板，请直接在输入框中粘贴。'); dom.input.focus(); }
  });
  dom.retry.addEventListener('click', () => { dom.input.value = lastJobInput; startJob(); });
  dom.cancel.addEventListener('click', cancelJob);
  dom.browser.addEventListener('click', openBrowser);
  dom.loginBrowser.addEventListener('click', openBrowser);
  dom.logout.addEventListener('click', logoutSession);
  dom.refreshQr.addEventListener('click', refreshQr);
  dom.dialogRefreshQr.addEventListener('click', refreshQr);
  dom.shot.addEventListener('click', showQrDialog);
  dom.shot.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showQrDialog(); }
  });
  dom.qrClose.addEventListener('click', closeQrDialog);
  dom.qrDialog.addEventListener('close', () => document.body.classList.remove('has-qr-dialog'));
  dom.qrDialog.addEventListener('click', (event) => {
    if (event.target !== dom.qrDialog) return;
    const bounds = dom.qrDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeQrDialog();
  });
  dom.select.addEventListener('change', () => showCandidate(Number(dom.select.value)));
  dom.download.addEventListener('click', (event) => { event.preventDefault(); saveVideo(); });
  dom.imageZip.addEventListener('click', () => saveFiles((activeJob?.result?.candidates || []).flatMap((candidate, index) => candidate.kind === 'image' ? [index] : []), true));
  dom.downloadCancel.addEventListener('click', () => {
    if (!saving) return;
    dom.downloadCancel.disabled = true;
    dom.downloadState.textContent = '正在停止保存';
    downloadController?.abort();
  });
  dom.contentCopy.addEventListener('click', copyContent);
  dom.contentSave.addEventListener('click', saveContent);
  dom.video.addEventListener('loadedmetadata', () => { dom.duration.textContent = durationLabel(dom.video.duration); });
  dom.video.addEventListener('error', () => {
    if (!dom.video.getAttribute('src')) return;
    dom.duration.textContent = '未知';
    dom.video.hidden = true;
    dom.fallback.hidden = false;
    dom.previewError.hidden = false;
    const messages = { 1: '预览加载已中止。', 2: '视频预览读取失败。', 3: '浏览器无法解码此视频。', 4: '视频文件无法读取或编码不受支持，请重新提取。' };
    dom.previewError.textContent = messages[dom.video.error?.code] || '视频预览无法加载。';
  });
  dom.export.addEventListener('click', () => {
    if (!activeJob) return;
    const visibleJob = {};
    for (const key of ['id', 'state', 'stage', 'inputUrl', 'platform', 'createdAt', 'finishedAt', 'received', 'total', 'events', 'result', 'error']) {
      if (activeJob[key] !== undefined) visibleJob[key] = activeJob[key];
    }
    if (visibleJob.events) visibleJob.events = visibleJob.events.map(event => ({ ...event, message: safeDiagnostic(event.message) }));
    if (visibleJob.error) visibleJob.error = typeof visibleJob.error === 'string' ? safeDiagnostic(visibleJob.error) : { ...visibleJob.error, message: safeDiagnostic(visibleJob.error.message) };
    const payload = { version: el('version').textContent, exportedAt: new Date().toISOString(), job: visibleJob };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `anma-job-${String(activeJob.id || jobId).slice(0, 8)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener('beforeunload', () => { clearTimeout(pollTimer); pollController?.abort(); stopScreenshots(); resetDownload(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && jobId && activeJob && !TERMINAL.has(activeJob.state)) pollJob(jobId); });

  try { const stored = localStorage.getItem('anma-share-input'); if (stored != null) dom.input.value = stored; } catch { /* Keep the provided sample when local storage is unavailable. */ }
  lastJobInput = dom.input.value || SAMPLE;
  el('service-address').textContent = location.origin;
  detectPlatform();
  icons();
  checkStatus(true);
  setInterval(updateElapsed, 1000);
  setInterval(() => checkStatus(), 10000);
})();
