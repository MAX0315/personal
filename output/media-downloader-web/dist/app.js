'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const MAX_FILE = 200 * 1024 * 1024;
  const state = { result: null, index: 0, bridge: false, bridgeVersion: '', connectionSerial: 0, inputInfo: null, recovery: null, viaBridge: false, parsing: false, serial: 0, parseAbort: null, previewSerial: 0, previewAttempts: null, localFile: null, localUrl: null, audioRunning: false, audioViaBridge: false, worker: null, audioAbort: null, audioSerial: 0, audioBlob: null, audioName: '', mismatch: false, downloadRunning: false };
  let downloadTimer = null;
  let audioTimer = null;
  let previewTimer = null;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const platforms = { channels: '视频号', douyin: '抖音', xhs: '小红书', xiaohongshu: '小红书', bilibili: '哔哩哔哩', direct: '媒体直链', local: '本地文件' };
  const canonicalPlatform = platform => platform === 'xhs' ? 'xiaohongshu' : platform;
  const extensionID = () => window.ANMA_EXTENSION_ID || '';
  const bridgeAvailable = () => Boolean(extensionID() && window.chrome?.runtime?.sendMessage);
  const current = () => state.result?.candidates?.[state.index] || null;
  const sourceURL = item => item?.videoUrl || item?.url || item?.mediaUrl || '';
  const filename = item => item?.fileName || item?.filename || 'media.mp4';
  function safeName(value, fallback = 'media') { return String(value || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || fallback; }
  function seconds(value) { const n = Number(value); if (!(n > 0)) return '—'; const t = Math.round(n); return (t >= 3600 ? Math.floor(t / 3600) + ':' : '') + String(Math.floor(t / 60) % 60).padStart(t >= 3600 ? 2 : 1, '0') + ':' + String(t % 60).padStart(2, '0'); }
  function setStatus(text, kind = '') { $('status').className = 'status' + (kind ? ' ' + kind : ''); $('statusText').textContent = text; }
  function inputInfo(text) {
    const match = String(text || '').match(/https?:\/\/[^\s<>"'\u3000“”‘’「」『』]+/i);
    if (!match) return null;
    const extracted = match[0].replace(/[，。；、！？”’）】》」』,;!?\])}]+$/u, '');
    try {
      const url = new URL(extracted);
      if (url.username || url.password) return null;
      const host = url.hostname.toLowerCase();
      const belongs = domain => host === domain || host.endsWith('.' + domain);
      const platform = belongs('douyin.com') || belongs('iesdouyin.com') ? 'douyin' : ['weixin.qq.com', 'channels.weixin.qq.com', 'wx.qq.com'].includes(host) ? 'channels' : belongs('xiaohongshu.com') || belongs('xhslink.com') ? 'xiaohongshu' : belongs('bilibili.com') || belongs('b23.tv') || belongs('bili2233.cn') ? 'bilibili' : 'direct';
      return { url: extracted, platform };
    } catch (_) { return null; }
  }
  function refreshInput() {
    state.inputInfo = inputInfo($('urlInput').value);
    $('detectedLink').hidden = !state.inputInfo;
    if (state.inputInfo) { $('detectedPlatform').textContent = platforms[state.inputInfo.platform] || '链接'; $('detectedUrl').textContent = state.inputInfo.url; }
    $('loginBtn').hidden = !state.bridge || state.inputInfo?.platform !== 'channels';
    return state.inputInfo;
  }
  function recoveryTarget(result, info) {
    const platform = canonicalPlatform(result?.platform || info?.platform);
    const id = String(result?.videoId || result?.targetId || '');
    if (platform === 'douyin' && /^\d{10,25}$/.test(id)) return 'https://www.douyin.com/video/' + id;
    const value = result?.pageUrl || info?.url;
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
      const actual = inputInfo(value);
      return actual && actual.platform === platform ? value : '';
    } catch (_) { return ''; }
  }
  function showRecovery(result, info = state.inputInfo) {
    const platform = canonicalPlatform(result?.platform || info?.platform || 'direct'), label = platforms[platform] || '平台';
    state.recovery = { ...result, platform, inputUrl: info?.url || '', targetUrl: recoveryTarget(result, info) };
    $('bridgeHelp').hidden = false;
    $('bridgeHelpTitle').textContent = label + '作品需要在 Chrome 中读取';
    const login = platform === 'channels' ? '首次使用请正常登录腾讯账号。' : '如果平台要求登录或验证，请在该平台网页正常完成，再播放这条作品。';
    $('bridgeHelpText').textContent = state.bridge ? '插件已连接。请在目标作品页面确认能正常播放。' + login + '完成后回到这里点击“通过插件重新解析”。' : '分享链接已经识别，公开解析未取得播放源。请用 Chrome 打开本网页，安装 v1.8.2 插件后连接并重试，插件会打开目标作品读取正常播放源。' + login;
    const target = state.recovery.targetUrl;
    $('bridgeTargetLink').hidden = !target; $('bridgeTargetUrl').hidden = !target;
    if (target) { $('bridgeTargetLink').href = target; $('bridgeTargetLink').textContent = '打开' + label + '目标作品 ↗'; $('bridgeTargetUrl').textContent = target; }
    $('bridgeRetryBtn').textContent = state.bridge ? '通过插件重新解析' : '连接插件并重试';
    $('bridgeChromeBtn').hidden = bridgeAvailable();
    if (!state.bridge) { $('chromeGuide').open = true; $('connectionBadge').textContent = bridgeAvailable() ? '此作品需要连接插件' : '请在 Chrome 中连接插件'; }
    $('loginBtn').hidden = !state.bridge || platform !== 'channels';
  }
  async function copySiteAddress() {
    const address = location.origin;
    try { await navigator.clipboard.writeText(address); $('siteCopyState').textContent = '网页地址已复制。打开 Chrome，粘贴到地址栏即可。'; setStatus('网页地址已复制，请用 Chrome 打开并加载 v1.8.2 插件。'); }
    catch (_) { $('siteCopyState').textContent = '请复制这个网页地址到 Chrome：' + address; }
    $('chromeGuide').open = true;
  }
  function mediaURL(item, download = false) { const query = new URLSearchParams({ url: sourceURL(item), filename: safeName(filename(item)), kind: item?.kind === 'image' ? 'image' : 'video', download: download ? '1' : '0' }); return '/api/media?' + query.toString(); }
  function previewURL(item) { return state.viaBridge ? sourceURL(item) : mediaURL(item); }
  function setControls() {
    const item = current(), isImage = item?.kind === 'image';
    $('analyzeBtn').disabled = state.parsing || state.audioRunning;
    $('pasteBtn').disabled = state.parsing;
    $('downloadBtn').disabled = state.downloadRunning || state.parsing || state.mismatch || !item || !['video', 'image'].includes(item.kind) || Boolean(state.localFile);
    $('audioBtn').disabled = state.audioRunning || state.parsing || state.mismatch || item?.kind !== 'video';
    $('localAudioBtn').disabled = !state.localFile || state.audioRunning || state.parsing;
    $('downloadImagesBtn').disabled = state.downloadRunning || state.parsing || !isImage;
    $('qualitySelect').disabled = state.parsing || state.audioRunning || state.downloadRunning || (state.result?.candidates.length || 0) < 2;
    $('frameBtn').disabled = state.parsing || state.mismatch || isImage || !$('preview').videoWidth;
    $('bridgeRetryBtn').disabled = state.parsing || state.audioRunning;
  }
  function send(type, payload = {}, timeout = 12000) {
    return new Promise((resolve, reject) => {
      if (!extensionID() || !window.chrome?.runtime?.sendMessage) return reject(new Error('当前浏览器尚未连接网页兼容插件。请在 Chrome 中加载兼容插件，再点击连接。'));
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('插件响应超时，请确认插件已启用并重新连接。')); } }, timeout);
      try {
        chrome.runtime.sendMessage(extensionID(), { source: 'anma-web', type, ...payload }, response => {
          const runtimeError = chrome.runtime.lastError;
          if (settled) return;
          settled = true; clearTimeout(timer);
          if (runtimeError) return reject(new Error('未连接到网页兼容插件。请加载新版插件后重新连接。'));
          if (!response) return reject(new Error('插件未返回结果，请重新连接。'));
          resolve(response);
        });
      } catch (_) { clearTimeout(timer); settled = true; reject(new Error('当前浏览器无法连接 Chrome 插件。可继续使用公开链接解析或本地 MP3 转换。')); }
    });
  }
  async function connect(quiet = false, timeout = 4500) {
    const connectionSerial = ++state.connectionSerial;
    $('connectBtn').disabled = true;
    try {
      const response = await send('ping', {}, timeout);
      if (connectionSerial !== state.connectionSerial) return state.bridge;
      if (response.error || response.ok === false) throw new Error(response.error || '插件连接失败。');
      state.bridge = true; state.bridgeVersion = response.version || '';
      $('connectionBadge').textContent = '已连接' + (response.version ? ' · v' + response.version : '');
      $('connectionBadge').classList.add('connected');
      $('connectBtn').textContent = '重新连接';
      const older = /^1\.8\.[01]$/.test(state.bridgeVersion);
      $('connectionInfo').textContent = older ? '已连接旧版插件。下载并加载 v1.8.2，可自动打开目标作品页并重试解析。' : 'Chrome 插件已连接。解析时会读取目标作品页面；需要登录或验证时，在平台网页正常完成即可。';
      $('loginBtn').hidden = state.inputInfo?.platform !== 'channels';
      if (state.recovery) showRecovery(state.recovery);
      if (!quiet) setStatus('已连接 Chrome 插件，可以重新解析作品链接。', 'success');
      return true;
    } catch (error) {
      if (connectionSerial !== state.connectionSerial) return state.bridge;
      state.bridge = false; state.bridgeVersion = ''; $('connectionBadge').textContent = bridgeAvailable() ? '未连接 · 登录内容需要插件' : '当前浏览器未连接插件'; $('connectionBadge').classList.remove('connected'); $('loginBtn').hidden = true;
      $('connectionInfo').textContent = bridgeAvailable() ? '请加载或启用 v1.8.2 插件。每次解析前会自动检查连接，公开链接也可直接尝试。' : '当前页面尚未检测到插件连接。公开链接可直接解析；需要平台页面时，请确认使用 Chrome，并加载 v1.8.2 插件。';
      if (state.recovery) showRecovery(state.recovery);
      if (!quiet) { setStatus(error.message, 'error'); $('chromeGuide').open = true; }
      return false;
    } finally { if (connectionSerial === state.connectionSerial) $('connectBtn').disabled = false; }
  }
  function clearPreview() {
    clearTimeout(previewTimer); previewTimer = null; state.previewSerial++;
    const video = $('preview'); video.pause(); video.removeAttribute('src'); video.onloadedmetadata = null; video.onloadeddata = null; video.onerror = null; video.load();
    const image = $('imagePreview'); image.onload = null; image.onerror = null; image.removeAttribute('src');
    $('previewNotice').textContent = ''; $('downloadState').textContent = '';
  }
  function clearAudioArtifact() { if (!state.audioRunning) { state.audioBlob = null; state.audioName = ''; $('saveAudioBtn').hidden = true; $('audioTask').hidden = true; } }
  function resetResult() { clearPreview(); clearAudioArtifact(); state.previewAttempts = null; state.result = null; state.index = 0; state.viaBridge = false; state.mismatch = false; state.recovery = null; $('result').hidden = true; $('emptyPreview').hidden = false; $('sourceChip').textContent = '待解析'; $('bridgeHelp').hidden = true; setControls(); }
  function cancelAnalysis() { state.serial++; state.parseAbort?.abort(); state.parseAbort = null; state.parsing = false; setControls(); }
  function candidateDescription(item, index) {
    if (item.kind === 'image') return '原图 ' + (Number(item.imageIndex ?? index) + 1) + (item.imageCount ? ' / ' + item.imageCount : '') + (item.width && item.height ? ' · ' + item.width + '×' + item.height : '');
    const role = item.sourceRole === 'native-playback' ? '原始播放源' : item.sourceRole === 'share-download' ? '分享下载源' : '视频播放源';
    const mark = item.watermark === 'present' ? ' · 含平台水印' : item.watermark === 'none' ? ' · 来源声明无水印' : '';
    return (index + 1) + '. ' + role + (item.width && item.height ? ' · ' + item.width + '×' + item.height : '') + mark + (item.rejectedReason ? ' · 已阻止' : '');
  }
  function applyResult(result, viaBridge) {
    if (result?.error || !result?.candidates?.length) {
      if (result?.needsBridge || result?.needsLogin || result?.requiresPage || result?.platform === 'channels') showRecovery(result);
      throw new Error(result?.error || '没有找到可保存的媒体源，请核对链接后重试。');
    }
    const candidates = result.candidates.filter(item => {
      try { const url = new URL(sourceURL(item)); return ['https:', 'http:'].includes(url.protocol); } catch (_) { return false; }
    });
    if (!candidates.length) throw new Error('解析结果没有有效的媒体地址。请重新解析。');
    if (candidates.length !== result.candidates.length && viaBridge) throw new Error('插件返回了无效的媒体源，请重新解析。');
    state.result = { ...result, candidates }; state.viaBridge = viaBridge;
    const preferredImage = candidates.findIndex(item => item.kind === 'image' && !item.rejectedReason);
    const preferredVideo = candidates.findIndex(item => item.kind === 'video' && !item.rejectedReason && item.sourceRole === 'native-playback');
    state.index = preferredImage >= 0 ? preferredImage : preferredVideo >= 0 ? preferredVideo : Math.max(0, candidates.findIndex(item => !item.rejectedReason));
    const select = $('qualitySelect'); select.replaceChildren();
    candidates.forEach((item, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = candidateDescription(item, index); select.append(option); });
    select.value = String(state.index); $('result').hidden = false; $('emptyPreview').hidden = true; $('sourceSelectWrap').hidden = false;
    renderCandidate();
    setStatus('已找到 ' + candidates.length + ' 个媒体源，先核对预览，再保存素材。', 'success');
  }
  function codecName(item) {
    const value = String(item?.codec || '').toLowerCase();
    if (/h264|avc/.test(value)) return 'h264';
    if (/h265|hevc|bytevc1/.test(value)) return 'h265';
    if (/vp9/.test(value)) return 'vp9';
    if (/vp8/.test(value)) return 'vp8';
    if (/av1/.test(value)) return 'av1';
    return value;
  }
  function compatibleCodec(item) {
    const value = codecName(item), types = { h264: 'video/mp4; codecs="avc1.42E01E"', h265: 'video/mp4; codecs="hvc1.1.6.L93.B0"', vp9: 'video/webm; codecs="vp9"', vp8: 'video/webm; codecs="vp8"', av1: 'video/mp4; codecs="av01.0.04M.08"' };
    return !value || Boolean(types[value] && $('preview').canPlayType(types[value]));
  }
  function previewFailure(item, serial, loaded = false) {
    if (serial !== state.previewSerial || current() !== item) return;
    clearTimeout(previewTimer); previewTimer = null;
    const attempt = state.previewAttempts;
    if (!loaded && !state.audioRunning && !state.downloadRunning && !state.mismatch && state.viaBridge && state.result?.matched === true && attempt?.result === state.result && String(item.videoId || '') === attempt.targetId) {
      const options = attempt.hosts.size >= 3 ? [] : state.result.candidates.map((candidate, index) => {
        try { return { candidate, index, url: new URL(sourceURL(candidate)) }; } catch (_) { return null; }
      }).filter(option => {
        if (!option) return false;
        const candidate = option.candidate;
        if (option.index === state.index || candidate.kind !== 'video' || candidate.rejectedReason || String(candidate.videoId || '') !== attempt.targetId || option.url.protocol !== 'https:' || attempt.hosts.has(option.url.hostname) || !compatibleCodec(candidate)) return false;
        const expected = Number(item.duration || state.result.duration), duration = Number(candidate.duration);
        return !(expected > 0 && duration > 0 && Math.abs(duration - expected) > Math.max(2, expected * .04));
      }).sort((a, b) => {
        const h264 = Number(codecName(b.candidate) === 'h264') - Number(codecName(a.candidate) === 'h264');
        if (h264) return h264;
        const area = Number(item.width) * Number(item.height);
        const distance = candidate => { const other = Number(candidate.width) * Number(candidate.height); return area > 0 && other > 0 ? Math.abs(Math.log(other / area)) : 1; };
        return distance(a.candidate) - distance(b.candidate) || a.index - b.index;
      });
      if (options.length) {
        state.index = options[0].index; $('qualitySelect').value = String(state.index);
        renderCandidate(true, '当前播放源未响应，正在尝试同一作品的备用播放源（' + (attempt.hosts.size + 1) + '/3）…');
        return;
      }
      $('previewNotice').textContent = attempt.hosts.size >= 3 ? '已尝试 3 个播放源，暂时无法预览。请手动选择其他素材源或重新解析。' : '这个播放源暂时不可用，未找到同一作品的可用备用源。请手动换源或重新解析。';
    } else $('previewNotice').textContent = '预览暂不可用，可能是地址过期、来源访问限制或浏览器不支持编码。可重新解析或尝试其他素材源。';
    setControls();
  }
  function renderCandidate(automatic = false, notice = '') {
    clearPreview(); clearAudioArtifact(); const item = current(); if (!item) return;
    if (!automatic) state.previewAttempts = null;
    const isImage = item.kind === 'image', images = state.result.candidates.filter(i => i.kind === 'image' && (!item.imageSetId || item.imageSetId === i.imageSetId));
    state.mismatch = Boolean(item.rejectedReason);
    $('sourceChip').textContent = platforms[item.platform || state.result.platform] || '媒体源';
    $('videoTitle').textContent = item.title || state.result.title || (isImage ? '图文素材' : '视频素材');
    $('videoId').textContent = item.id || item.videoId || state.result.id || state.result.videoId || '—';
    $('durationLabel').textContent = isImage ? '图片数量' : '视频时长';
    $('duration').textContent = isImage ? images.length + ' 张' : seconds(item.duration || state.result.duration);
    $('fileName').textContent = filename(item); $('sourceUrl').textContent = new URL(sourceURL(item)).hostname;
    $('previewWrap').hidden = isImage; $('imagePreviewWrap').hidden = !isImage;
    $('downloadBtn').textContent = isImage ? '保存当前原图 ↓' : '保存视频 ↓';
    $('audioBtn').hidden = isImage; $('downloadImagesBtn').hidden = !isImage || images.length < 2; $('frameBtn').hidden = isImage;
    $('downloadImagesBtn').textContent = state.viaBridge ? '保存全部原图 ↓' : '打包全部原图 ↓';
    $('resultNote').textContent = item.rejectedReason || (isImage ? '已识别 ' + images.length + ' 张图片。可保存当前原图，或' + (state.viaBridge ? '通过 Chrome 批量保存到下载目录。' : '将全部图片打包为一个 ZIP。') : '作品源地址可能过期；下载失败时请重新解析。作者嵌入画面的标记会保留，水印情况请以预览为准。');
    if (state.mismatch) { $('previewNotice').textContent = item.rejectedReason; setControls(); return; }
    if (isImage) {
      $('imagePreview').onerror = () => { if (current() === item) $('previewNotice').textContent = '图片预览暂不可用，可重新加载或尝试保存原图。'; };
      $('imagePreview').onload = () => { if (current() === item) $('previewNotice').textContent = ''; };
      $('imagePreview').src = previewURL(item);
    } else if (item.kind === 'video') {
      const video = $('preview'), serial = state.previewSerial, result = state.result;
      const targetId = String(result.videoId || result.targetId || result.id || '');
      let loaded = false;
      if (state.viaBridge && result.matched === true && targetId && String(item.videoId || '') === targetId) {
        if (!state.previewAttempts || state.previewAttempts.result !== result) state.previewAttempts = { result, targetId, hosts: new Set() };
        state.previewAttempts.hosts.add(new URL(sourceURL(item)).hostname);
      }
      video.onloadedmetadata = () => {
        if (serial !== state.previewSerial || current() !== item || state.result !== result) return;
        const expected = Number(item.duration || state.result?.duration), actual = video.duration;
        if (state.result?.matched && expected > 0 && Number.isFinite(actual) && Math.abs(actual - expected) > Math.max(2, expected * .04)) {
          state.mismatch = true; item.rejectedReason = '视频时长与作品不一致，已阻止保存。请更换素材源或重新解析。';
          clearTimeout(previewTimer); previewTimer = null;
          $('previewNotice').textContent = '预期 ' + seconds(expected) + '，播放源 ' + seconds(actual) + '。' + item.rejectedReason;
          setStatus('视频时长不一致，请换源或重新解析。', 'error');
          if (state.viaBridge) void send('rejectCandidate', { token: state.result.token, index: state.index, actualDuration: actual }).catch(() => {});
        } else if (Number.isFinite(actual) && actual > 0) $('duration').textContent = seconds(actual);
        setControls();
      };
      video.onloadeddata = () => { if (serial !== state.previewSerial || current() !== item || state.result !== result) return; loaded = true; clearTimeout(previewTimer); previewTimer = null; if (automatic && !state.mismatch) $('previewNotice').textContent = '已自动切换到可用播放源，请核对预览后保存。'; setControls(); };
      video.onerror = () => previewFailure(item, serial, loaded);
      if (notice) $('previewNotice').textContent = notice;
      video.src = previewURL(item); video.load();
      if (state.viaBridge && state.previewAttempts?.result === result) previewTimer = setTimeout(() => previewFailure(item, serial, loaded), 15000);
    } else $('previewNotice').textContent = '当前为分片流，暂不支持网页内直接保存，请选择单文件视频源。';
    setControls();
  }
  async function analyze(event, forceBridge = false) {
    event?.preventDefault(); if (state.parsing || state.audioRunning) return;
    const info = refreshInput(), previousRecovery = state.recovery;
    if (!info) return setStatus('请粘贴有效的 http 或 https 分享链接，或包含链接的完整分享文案。', 'error');
    cancelAnalysis(); releaseLocal(); resetResult(); state.parsing = true; setControls();
    const serial = state.serial; let viaBridge = false; state.parseAbort = new AbortController();
    setStatus('已识别' + (platforms[info.platform] || '作品') + '链接，正在检查插件连接…', 'busy');
    try {
      const connected = await connect(true, 2500);
      if (serial !== state.serial) return;
      viaBridge = connected;
      if (forceBridge && !viaBridge) {
        showRecovery(previousRecovery || { needsBridge: true, platform: info.platform, pageUrl: info.url }, info);
        setStatus(bridgeAvailable() ? '尚未连接到插件。请加载或启用 v1.8.2，连接后重试。' : '当前页面尚未检测到插件。请复制网页地址，用 Chrome 打开并加载 v1.8.2。', 'error');
        return;
      }
      setStatus(viaBridge ? '正在通过 Chrome 插件读取' + (platforms[info.platform] || '') + '作品，必要时会打开目标页面…' : '正在解析' + (platforms[info.platform] || '') + '公开链接，请稍候…', 'busy');
      let result;
      if (viaBridge) {
        const start = await send('startAnalysis', { pageUrl: info.url });
        if (serial !== state.serial) return;
        if (start.error || !start.jobId) { showRecovery(start, info); throw new Error(start.error || '插件解析任务未启动。'); }
        const began = Date.now();
        while (serial === state.serial) {
          const job = await send('analysisStatus');
          if (serial !== state.serial) return;
          if (job.jobId !== start.jobId) throw new Error('插件解析任务已被新的链接替换，请重新解析。');
          if (job.state === 'complete' || job.state === 'error') { result = job.result || { error: job.error || '解析失败。' }; break; }
          if (job.error || !['running', 'preparing'].includes(job.state)) throw new Error(job.error || '插件解析状态异常，请重试。');
          if (Date.now() - began > 180000) throw new Error('作品读取超时。请确认正常登录状态，再重新解析。');
          await wait(850);
        }
      } else {
        const response = await fetch('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageUrl: info.url }), signal: state.parseAbort.signal });
        try { result = await response.json(); } catch (_) { throw new Error('解析服务暂不可用，请稍后重试。'); }
        if (!response.ok && !result.error) result.error = '解析服务返回错误，请稍后重试。';
      }
      if (serial !== state.serial) return;
      applyResult(result, viaBridge);
    } catch (error) { if (serial === state.serial && error.name !== 'AbortError') { if (viaBridge && !state.recovery) showRecovery({ error: error.message, requiresPage: true, platform: info.platform, pageUrl: info.url }, info); setStatus(error.message || '解析失败，请重新尝试。', 'error'); } }
    finally { if (serial === state.serial) { state.parsing = false; state.parseAbort = null; setControls(); } }
  }
  async function readMedia(item, signal, onProgress) {
    const response = await fetch(mediaURL(item, true), { signal });
    if (!response.ok) { let detail; try { detail = await response.json(); } catch (_) {} throw new Error(detail?.error || '源文件读取失败（HTTP ' + response.status + '），请重新解析。'); }
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_FILE) throw new Error('源文件超过 200 MB，请选择更小的素材。');
    if (!response.body?.getReader) { const blob = await response.blob(); if (blob.size > MAX_FILE) throw new Error('源文件超过 200 MB。'); return blob; }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_FILE) { await reader.cancel(); throw new Error('源文件超过 200 MB，请选择更小的素材。'); } chunks.push(value); onProgress?.(size, length); }
    } finally { reader.releaseLock(); }
    if (size < 32) throw new Error('没有读取到有效的素材文件，请重新解析。');
    return new Blob(chunks, { type: response.headers.get('content-type') || (item.kind === 'image' ? 'image/jpeg' : 'video/mp4') });
  }
  function saveBlob(blob, name) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = safeName(name); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  async function updateDownloadStatus() {
    try {
      const job = await send('downloadStatus');
      if (job.error && !job.state) throw new Error(job.error);
      if (job.state === 'complete') { $('downloadState').textContent = job.invalid ? '下载文件可能无效，请重新解析并核对内容。' : job.batchCount > 1 ? 'Chrome 已报告图片保存完成：' + job.completeCount + ' / ' + job.batchCount + ' 张。' : 'Chrome 已报告文件保存完成：' + (job.filename || '请查看下载列表'); clearInterval(downloadTimer); downloadTimer = null; }
      else if (job.state === 'interrupted') { $('downloadState').textContent = '下载中断：' + (job.error || '请重新解析并重试。'); clearInterval(downloadTimer); downloadTimer = null; }
      else $('downloadState').textContent = 'Chrome 正在保存素材 · 已接收 ' + ((Number(job.bytesReceived) || 0) / 1048576).toFixed(1) + ' MB';
    } catch (error) { $('downloadState').textContent = error.message; clearInterval(downloadTimer); downloadTimer = null; }
  }
  async function downloadSelected() {
    const item = current(); if (!item || state.mismatch || state.downloadRunning || state.localFile) return;
    state.downloadRunning = true; setControls();
    try {
      if (state.viaBridge) { const response = await send('download', { token: state.result.token, index: state.index }); if (response.error) throw new Error(response.error); $('downloadState').textContent = '已交给 Chrome 保存，正在等候下载状态…'; clearInterval(downloadTimer); downloadTimer = setInterval(updateDownloadStatus, 1500); await updateDownloadStatus(); }
      else { $('downloadState').textContent = '正在读取素材文件…'; const blob = await readMedia(item, undefined, size => { $('downloadState').textContent = '正在读取素材 · ' + (size / 1048576).toFixed(1) + ' MB'; }); saveBlob(blob, filename(item)); $('downloadState').textContent = '文件已交给浏览器保存，请在下载列表确认。'; }
    } catch (error) { $('downloadState').textContent = error.message; setStatus(error.message, 'error'); }
    finally { state.downloadRunning = false; setControls(); }
  }
  function crc32(bytes) { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
  function zipStore(files) {
    const encoder = new TextEncoder(), parts = [], directory = []; let offset = 0, directorySize = 0;
    for (const file of files) {
      const name = encoder.encode(safeName(file.name)), data = file.data, crc = crc32(data), local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true); view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true); local.set(name, 30); parts.push(local, data);
      const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer); cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); central.set(name, 46); directory.push(central); directorySize += central.length; offset += local.length + data.length;
    }
    const end = new Uint8Array(22), ev = new DataView(end.buffer); ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true); return new Blob([...parts, ...directory, end], { type: 'application/zip' });
  }
  async function downloadImages() {
    const selected = current(); if (selected?.kind !== 'image' || state.downloadRunning) return;
    const images = state.result.candidates.filter(item => item.kind === 'image' && !item.rejectedReason && (!selected.imageSetId || item.imageSetId === selected.imageSetId));
    state.downloadRunning = true; setControls();
    try {
      if (state.viaBridge) { const response = await send('downloadImages', { token: state.result.token, index: state.index }); if (response.error) throw new Error(response.error); $('downloadState').textContent = '已启动 ' + (response.count || images.length) + ' 张原图保存。' + (response.failedCount ? '有 ' + response.failedCount + ' 张未启动，请重试。' : ''); clearInterval(downloadTimer); downloadTimer = setInterval(updateDownloadStatus, 1500); }
      else {
        const files = []; let size = 0;
        for (let i = 0; i < images.length; i++) { $('downloadState').textContent = '正在打包原图 ' + (i + 1) + ' / ' + images.length + '…'; const blob = await readMedia(images[i]); size += blob.size; if (size > MAX_FILE) throw new Error('整组图片超过 200 MB，请改为逐张保存。'); files.push({ name: String(i + 1).padStart(2, '0') + '-' + filename(images[i]), data: new Uint8Array(await blob.arrayBuffer()) }); }
        const zip = zipStore(files); saveBlob(zip, safeName(selected.title || state.result.title || '原图素材') + '-原图.zip'); $('downloadState').textContent = '已将 ' + files.length + ' 张图片打包并交给浏览器保存，请查看下载列表。';
      }
    } catch (error) { $('downloadState').textContent = error.message; setStatus(error.message, 'error'); }
    finally { state.downloadRunning = false; setControls(); }
  }
  function releaseLocal() { if (state.localUrl) URL.revokeObjectURL(state.localUrl); state.localUrl = null; state.localFile = null; $('localFile').value = ''; $('fileLabel').textContent = '点击选择或拖入本地视频'; $('fileDetails').textContent = 'MP4、MOV、WebM 等 · 最大 200 MB'; }
  function changeTab(local) {
    $('linkTab').classList.toggle('active', !local); $('localTab').classList.toggle('active', local);
    $('linkTab').setAttribute('aria-selected', String(!local)); $('localTab').setAttribute('aria-selected', String(local));
    $('linkPanel').hidden = local; $('localPanel').hidden = !local;
    if (state.parsing) { cancelAnalysis(); setStatus('已停止等待解析。', ''); }
  }
  function chooseFile(file) {
    if (!file) return; cancelAnalysis(); if (state.audioRunning) cancelAudio(); resetResult(); releaseLocal();
    if (file.size > MAX_FILE) return setStatus('本地视频超过 200 MB，请选择较小的文件。', 'error');
    if (!file.size) return setStatus('选择的文件是空文件，请重新选择。', 'error');
    if (!/^video\//i.test(file.type) && !/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name)) return setStatus('请选择一个视频文件。', 'error');
    state.audioBlob = null; $('saveAudioBtn').hidden = true; $('audioTask').hidden = true;
    state.localFile = file; state.localUrl = URL.createObjectURL(file); changeTab(true);
    $('fileLabel').textContent = file.name; $('fileDetails').textContent = (file.size / 1048576).toFixed(1) + ' MB · 点击可重新选择';
    const item = { kind: 'video', videoUrl: state.localUrl, fileName: file.name, title: file.name, platform: 'local' };
    state.result = { candidates: [item], platform: 'local' }; state.index = 0; state.viaBridge = false;
    $('result').hidden = false; $('emptyPreview').hidden = true; $('sourceSelectWrap').hidden = true;
    $('sourceChip').textContent = '本地文件'; $('videoTitle').textContent = file.name; $('videoId').textContent = '设备内文件'; $('durationLabel').textContent = '视频时长'; $('duration').textContent = '—'; $('fileName').textContent = file.name; $('sourceUrl').textContent = '本地设备 · 不上传';
    $('previewWrap').hidden = false; $('imagePreviewWrap').hidden = true; $('audioBtn').hidden = false; $('downloadImagesBtn').hidden = true; $('frameBtn').hidden = false; $('downloadBtn').textContent = '已在本地';
    $('resultNote').textContent = '本地视频只在当前浏览器中处理。MP3 转换期间请保持这个网页开启。';
    $('preview').onloadedmetadata = () => { if (state.localFile === file) { item.duration = $('preview').duration; $('duration').textContent = seconds(item.duration); } };
    $('preview').onloadeddata = setControls; $('preview').onerror = () => { if (state.localFile === file) $('previewNotice').textContent = '当前浏览器可能不支持这个视频的预览编码，仍可尝试提取 MP3。'; };
    $('preview').src = state.localUrl; $('preview').load(); setStatus('本地视频已准备好，可以提取 MP3。', 'success'); setControls();
  }
  function finishAudio(message, error = false) { state.audioRunning = false; state.worker?.terminate(); state.worker = null; state.audioAbort = null; $('audioState').textContent = message; $('cancelAudioBtn').hidden = true; clearInterval(audioTimer); audioTimer = null; if (error) setStatus(message, 'error'); setControls(); }
  async function updateBridgeAudio(serial = state.audioSerial) {
    try {
      const job = await send('audioStatus');
      if (serial !== state.audioSerial || !state.audioRunning || !state.audioViaBridge) return;
      if (job.error && !job.state) throw new Error(job.error);
      const labels = { preparing: '正在准备浏览器内转换', fetching: '正在读取源文件', converting: '正在转换 MP3', saving: '转换完成，请确认 Chrome 保存提示', in_progress: 'Chrome 正在保存 MP3', complete: 'Chrome 已报告 MP3 保存完成', cancelled: 'MP3 任务已取消', interrupted: 'MP3 保存中断', error: 'MP3 处理失败' };
      $('audioState').textContent = (labels[job.state] || '正在处理音频') + (job.detail ? ' · ' + job.detail : '') + (job.error ? '：' + job.error : ''); $('audioProgress').value = job.state === 'complete' ? 100 : Math.min(100, Math.max(0, Number(job.percent) || 0));
      if (['complete', 'cancelled', 'interrupted', 'error'].includes(job.state)) finishAudio($('audioState').textContent, ['interrupted', 'error'].includes(job.state));
    } catch (error) { if (serial === state.audioSerial && state.audioRunning && state.audioViaBridge) finishAudio(error.message, true); }
  }
  async function startAudio() {
    const item = current(); if (state.audioRunning || state.parsing || state.mismatch || item?.kind !== 'video') return;
    state.audioRunning = true; state.audioViaBridge = state.viaBridge; state.audioBlob = null; state.audioSerial++; const serial = state.audioSerial;
    $('audioTask').hidden = false; $('cancelAudioBtn').hidden = false; $('saveAudioBtn').hidden = true; $('audioProgress').value = 0; $('audioState').textContent = '正在准备源文件…'; setControls();
    try {
      if (state.viaBridge) { const response = await send('startAudio', { token: state.result.token, index: state.index }); if (response.error) throw new Error(response.error); if (serial !== state.audioSerial) return; await updateBridgeAudio(serial); if (state.audioRunning && serial === state.audioSerial) audioTimer = setInterval(() => updateBridgeAudio(serial), 1000); return; }
      state.audioAbort = new AbortController();
      const blob = state.localFile || await readMedia(item, state.audioAbort.signal, (size, total) => { if (serial === state.audioSerial) { $('audioState').textContent = '正在读取源文件 · ' + (size / 1048576).toFixed(1) + ' MB'; $('audioProgress').value = total > 0 ? Math.min(19, size / total * 19) : 5; } });
      if (serial !== state.audioSerial) return;
      const input = await blob.arrayBuffer(); if (serial !== state.audioSerial) return;
      state.audioName = safeName(filename(item).replace(/\.[^.]+$/, '')) + '.mp3';
      $('audioState').textContent = '正在加载音频引擎，首次使用需要下载转换组件…';
      const worker = new Worker('/audio-worker.js'); state.worker = worker;
      worker.onmessage = ({ data }) => {
        if (serial !== state.audioSerial || !state.audioRunning) return;
        if (data.type === 'progress') { $('audioState').textContent = data.detail || '正在转换 MP3…'; $('audioProgress').value = 20 + Math.min(99, Math.max(0, Number(data.percent) || 0)) * .8; }
        else if (data.type === 'ready') { state.audioBlob = new Blob([data.buffer], { type: 'audio/mpeg' }); $('audioProgress').value = 100; $('saveAudioBtn').hidden = false; finishAudio('转换完成 · ' + state.audioName + ' · ' + (state.audioBlob.size / 1048576).toFixed(1) + ' MB。点击下方按钮保存。'); setStatus('MP3 已准备好，点击保存文件即可。', 'success'); }
        else if (data.type === 'failed') finishAudio(data.error || 'MP3 转换失败，请尝试其他视频。', true);
      };
      worker.onerror = () => { if (serial === state.audioSerial) finishAudio('转换引擎无法加载，请刷新页面后再试。', true); };
      worker.postMessage({ type: 'convert', input, duration: Number(item.duration || state.result?.duration) || 0 }, [input]);
    } catch (error) { if (serial === state.audioSerial && error.name !== 'AbortError') finishAudio(error.message || 'MP3 转换失败。', true); }
  }
  async function cancelAudio() {
    const viaBridge = state.audioViaBridge; state.audioSerial++; const serial = state.audioSerial; state.audioAbort?.abort(); state.worker?.terminate(); state.audioBlob = null; $('saveAudioBtn').hidden = true; finishAudio('MP3 任务已取消。');
    if (viaBridge) try { const response = await send('cancelAudio'); if (response.error) throw new Error(response.error); } catch (error) { if (serial === state.audioSerial) $('audioState').textContent = error.message; }
  }
  async function saveFrame() {
    const preview = $('preview'), item = current(); if (!item || !preview.videoWidth || state.mismatch) return;
    const video = document.createElement('video'); video.crossOrigin = 'anonymous'; video.preload = 'auto';
    $('frameBtn').disabled = true;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('首帧读取超时。')), 15000);
        video.onloadeddata = () => { clearTimeout(timer); resolve(); };
        video.onerror = () => { clearTimeout(timer); reject(new Error('首帧读取失败。')); };
        video.src = preview.currentSrc || preview.src; video.load();
      });
      const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .94)); if (!blob) throw new Error('无法读取首帧画面。'); saveBlob(blob, filename(item).replace(/\.[^.]+$/, '') + '-首帧.jpg'); $('downloadState').textContent = '首帧图片已交给浏览器保存。';
    } catch (_) { setStatus('这个来源不允许读取预览画面，请更换素材源或重新解析。', 'error'); }
    finally { video.removeAttribute('src'); video.load(); setControls(); }
  }
  $('resolveForm').addEventListener('submit', analyze);
  $('urlInput').addEventListener('input', () => { if (state.parsing) { cancelAnalysis(); setStatus('链接已更新，点击解析素材继续。'); } if ((state.result || state.recovery) && !state.localFile) resetResult(); refreshInput(); });
  $('urlInput').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') analyze(event); });
  $('clearBtn').addEventListener('click', () => { cancelAnalysis(); $('urlInput').value = ''; if (!state.localFile) resetResult(); refreshInput(); $('urlInput').focus(); setStatus('输入已清空，粘贴一个作品链接开始。'); });
  $('pasteBtn').addEventListener('click', async () => { try { const text = await navigator.clipboard.readText(); if (!text.trim()) return setStatus('剪贴板为空，请先复制作品链接。', 'error'); $('urlInput').value = text.slice(0, 12000); $('urlInput').dispatchEvent(new Event('input')); $('urlInput').focus(); setStatus('已粘贴分享文案，点击解析素材继续。'); } catch (_) { $('urlInput').focus(); setStatus('无法读取剪贴板，请使用 Ctrl + V 粘贴链接。'); } });
  $('linkTab').addEventListener('click', () => changeTab(false)); $('localTab').addEventListener('click', () => changeTab(true));
  $('localFile').addEventListener('change', event => chooseFile(event.target.files?.[0]));
  $('fileDrop').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('localFile').click(); } });
  ['dragenter', 'dragover'].forEach(type => $('fileDrop').addEventListener(type, event => { event.preventDefault(); $('fileDrop').classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(type => $('fileDrop').addEventListener(type, event => { event.preventDefault(); $('fileDrop').classList.remove('dragging'); }));
  $('fileDrop').addEventListener('drop', event => chooseFile(event.dataTransfer.files?.[0]));
  $('connectBtn').addEventListener('click', () => connect());
  $('copySiteBtn').addEventListener('click', copySiteAddress);
  $('bridgeChromeBtn').addEventListener('click', copySiteAddress);
  $('bridgeRetryBtn').addEventListener('click', () => analyze(undefined, true));
  $('loginBtn').addEventListener('click', async () => { try { const result = await send('channelsLogin'); if (result.error) throw new Error(result.error); setStatus('已打开腾讯登录页。请完成正常登录，再回到此页解析视频号。'); } catch (error) { setStatus(error.message, 'error'); } });
  $('qualitySelect').addEventListener('change', () => { state.index = Number($('qualitySelect').value); renderCandidate(); });
  $('downloadBtn').addEventListener('click', downloadSelected); $('downloadImagesBtn').addEventListener('click', downloadImages); $('frameBtn').addEventListener('click', saveFrame);
  $('audioBtn').addEventListener('click', startAudio); $('localAudioBtn').addEventListener('click', startAudio); $('cancelAudioBtn').addEventListener('click', cancelAudio);
  $('saveAudioBtn').addEventListener('click', () => { if (!state.audioBlob) return; saveBlob(state.audioBlob, state.audioName); $('audioState').textContent = 'MP3 文件已交给浏览器保存，请在下载列表确认。'; });
  $('retryPreviewBtn').addEventListener('click', () => { if (state.localFile) { $('preview').load(); $('previewNotice').textContent = ''; } else renderCandidate(); });
  window.addEventListener('beforeunload', event => { if (state.audioRunning && !state.audioViaBridge) { event.preventDefault(); event.returnValue = ''; } });
  void connect(true);
})();
