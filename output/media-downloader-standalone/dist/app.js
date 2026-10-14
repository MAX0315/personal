'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const MAX_FILE = 200 * 1024 * 1024;
  const state = { result: null, index: 0, inputInfo: null, failure: null, parsing: false, serial: 0, parseAbort: null, previewSerial: 0, previewAttempts: null, localFile: null, localUrl: null, audioRunning: false, worker: null, audioAbort: null, audioSerial: 0, audioBlob: null, audioName: '', mismatch: false, downloadRunning: false };
  let previewTimer = null;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const platforms = { channels: '视频号', douyin: '抖音', xhs: '小红书', xiaohongshu: '小红书', bilibili: '哔哩哔哩', direct: '媒体直链', local: '本地文件' };
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
    return state.inputInfo;
  }
  function mediaURL(item, download = false) { const query = new URLSearchParams({ url: sourceURL(item), filename: safeName(filename(item)), kind: item?.kind === 'image' ? 'image' : 'video', download: download ? '1' : '0' }); return '/api/media?' + query.toString(); }
  function previewURL(item) { return item?.previewUrl || (state.result?.clientPreview === false || item?.clientPreview === false ? mediaURL(item) : sourceURL(item)); }
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
    $('parseRetryBtn').disabled = state.parsing || state.audioRunning;
  }
  function clearPreview() {
    clearTimeout(previewTimer); previewTimer = null; state.previewSerial++;
    const video = $('preview'); video.pause(); video.removeAttribute('src'); video.onloadedmetadata = null; video.onloadeddata = null; video.onerror = null; video.load();
    const image = $('imagePreview'); image.onload = null; image.onerror = null; image.removeAttribute('src');
    $('previewNotice').textContent = ''; $('downloadState').textContent = '';
  }
  function clearAudioArtifact() { if (!state.audioRunning) { state.audioBlob = null; state.audioName = ''; $('saveAudioBtn').hidden = true; $('audioTask').hidden = true; } }
  function resetResult() { clearPreview(); clearAudioArtifact(); state.previewAttempts = null; state.result = null; state.index = 0; state.mismatch = false; state.failure = null; $('result').hidden = true; $('emptyPreview').hidden = false; $('sourceChip').textContent = '待解析'; $('parseHelp').hidden = true; $('channelsAuth').hidden = true; $('channelsQr').removeAttribute('src'); $('channelsAuthState').textContent = '正在准备二维码…'; setControls(); }
  function cancelAnalysis() { state.serial++; state.parseAbort?.abort(); state.parseAbort = null; state.parsing = false; setControls(); }
  function candidateDescription(item, index) {
    if (item.kind === 'image') return '原图 ' + (Number(item.imageIndex ?? index) + 1) + (item.imageCount ? ' / ' + item.imageCount : '') + (item.width && item.height ? ' · ' + item.width + '×' + item.height : '');
    const role = item.sourceRole === 'native-playback' ? '原始播放源' : item.sourceRole === 'share-download' ? '分享下载源' : '视频播放源';
    const mark = item.watermark === 'present' ? ' · 含平台水印' : item.watermark === 'none' ? ' · 来源声明无水印' : '';
    return (index + 1) + '. ' + role + (item.width && item.height ? ' · ' + item.width + '×' + item.height : '') + mark + (item.rejectedReason ? ' · 已阻止' : '');
  }
  function showFailure(result) {
    state.failure = result;
    if (result?.needsLogin || result?.requiresLogin || result?.permissionRequired || result?.requiresPage) {
      const restricted = Boolean(result?.needsLogin || result?.requiresLogin || result?.permissionRequired);
      $('parseHelp').hidden = false;
      $('parseHelpTitle').textContent = restricted ? '此作品需要平台登录或访问权限' : '暂未取得可保存的播放源';
      $('parseHelpText').textContent = result?.detail || (restricted ? '平台未向当前网页提供这个作品的完整媒体源。你在其他网页登录的账号不会自动传给本网站，当前无法保证保存这条作品。' : '请确认分享链接有效、作品公开且可以正常播放，再重新解析。');
      $('parseRetryBtn').hidden = restricted;
    }
  }
  function applyResult(result) {
    if (result?.error || !result?.candidates?.length) { showFailure(result); throw new Error(result?.error || '没有找到可保存的媒体源，请核对链接后重试。'); }
    $('channelsAuth').hidden = true;
    $('channelsQr').removeAttribute('src');
    const candidates = result.candidates.filter(item => { try { const url = new URL(sourceURL(item)); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch (_) { return false; } });
    if (!candidates.length) throw new Error('解析结果没有有效的媒体地址。请重新解析。');
    state.result = { ...result, candidates };
    const preferredImage = candidates.findIndex(item => item.kind === 'image' && !item.rejectedReason);
    const preferredVideo = candidates.findIndex(item => item.kind === 'video' && !item.rejectedReason && item.sourceRole === 'native-playback');
    state.index = preferredImage >= 0 ? preferredImage : preferredVideo >= 0 ? preferredVideo : Math.max(0, candidates.findIndex(item => !item.rejectedReason));
    const select = $('qualitySelect'); select.replaceChildren();
    candidates.forEach((item, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = candidateDescription(item, index); select.append(option); });
    select.value = String(state.index); $('result').hidden = false; $('emptyPreview').hidden = true; $('sourceSelectWrap').hidden = false;
    renderCandidate(); setStatus('已找到 ' + candidates.length + ' 个媒体源，核对预览后即可保存。', 'success');
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
    if (!loaded && !state.audioRunning && !state.downloadRunning && !state.mismatch && state.result?.matched === true && attempt?.result === state.result && String(item.videoId || '') === attempt.targetId) {
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
    $('downloadImagesBtn').textContent = '打包全部原图 ↓';
    $('resultNote').textContent = item.rejectedReason || (isImage ? '已识别 ' + images.length + ' 张图片。可保存当前原图，或' + '将全部图片打包为一个 ZIP。' : '作品源地址可能过期；下载失败时请重新解析。作者嵌入画面的标记会保留，水印情况请以预览为准。');
    if (state.mismatch) { $('previewNotice').textContent = item.rejectedReason; setControls(); return; }
    if (isImage) {
      $('imagePreview').onerror = () => { if (current() === item) $('previewNotice').textContent = '图片预览暂不可用，可重新加载或尝试保存原图。'; };
      $('imagePreview').onload = () => { if (current() === item) $('previewNotice').textContent = ''; };
      $('imagePreview').src = previewURL(item);
    } else if (item.kind === 'video') {
      const video = $('preview'), serial = state.previewSerial, result = state.result;
      const targetId = String(result.videoId || result.targetId || result.id || '');
      let loaded = false;
      if (result.matched === true && targetId && String(item.videoId || '') === targetId) {
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
        } else if (Number.isFinite(actual) && actual > 0) $('duration').textContent = seconds(actual);
        setControls();
      };
      video.onloadeddata = () => { if (serial !== state.previewSerial || current() !== item || state.result !== result) return; loaded = true; clearTimeout(previewTimer); previewTimer = null; if (automatic && !state.mismatch) $('previewNotice').textContent = '已自动切换到可用播放源，请核对预览后保存。'; setControls(); };
      video.onerror = () => previewFailure(item, serial, loaded);
      if (notice) $('previewNotice').textContent = notice;
      video.src = previewURL(item); video.load();
      if (state.previewAttempts?.result === result) previewTimer = setTimeout(() => previewFailure(item, serial, loaded), 15000);
    } else $('previewNotice').textContent = '当前为分片流，暂不支持网页内直接保存，请选择单文件视频源。';
    setControls();
  }
  function showChannelsEvent(event) {
    if (!event || event.type === 'heartbeat') return;
    $('channelsAuth').hidden = false;
    if (event.type === 'qr' && event.image) { $('channelsQr').src = event.image; $('channelsAuthState').textContent = event.message || '请使用微信扫码，完成后会自动继续。'; setStatus('请使用微信扫描网页中的二维码，完成后会自动解析视频号作品。', 'busy'); }
    else if (event.message) { $('channelsAuthState').textContent = event.message; setStatus(event.message, 'busy'); }
  }
  async function readChannelsStream(response, serial, signal) {
    if (!response.body?.getReader) throw new Error('视频号网页会话无法建立，请重新解析。');
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', result = null;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
        for (const line of lines) { if (!line.trim()) continue; let event; try { event = JSON.parse(line); } catch { continue; } if (serial !== state.serial || signal.aborted) return null; if (event.type === 'result') result = event.result; else showChannelsEvent(event); }
      }
      buffer += decoder.decode(); if (buffer.trim()) { try { const event = JSON.parse(buffer); if (event.type === 'result') result = event.result; else showChannelsEvent(event); } catch {} }
    } finally { try { reader.releaseLock(); } catch {} }
    return result || { error: '视频号网页会话已结束，请重新解析。', reasonCode: 'CHANNELS_EMPTY', platform: 'channels', candidates: [] };
  }
  async function waitForChannelsJob(jobId, serial, signal) {
    const deadline = Date.now() + 12 * 60 * 1000;
    let lastQr = '';
    while (Date.now() < deadline) {
      if (serial !== state.serial || signal.aborted) return null;
      const response = await fetch('/api/channels-status?job=' + encodeURIComponent(jobId), { signal, cache: 'no-store' });
      let status; try { status = await response.json(); } catch (_) { throw new Error('视频号会话状态读取失败，请重试。'); }
      if (status.qr && status.qr !== lastQr) { lastQr = status.qr; showChannelsEvent({ type: 'qr', image: status.qr, message: status.message || '请使用微信扫码，完成后会自动继续。' }); }
      else if (status.message) showChannelsEvent({ type: 'status', message: status.message });
      if (status.status === 'done' || status.status === 'error') return status.result || { error: status.message || '视频号解析失败，请重试。', reasonCode: 'CHANNELS_JOB_FAILED', platform: 'channels', candidates: [] };
      await wait(1800);
    }
    return { error: '视频号网页会话等待超时，请重新解析并及时完成扫码。', reasonCode: 'CHANNELS_TIMEOUT', platform: 'channels', candidates: [] };
  }
  async function analyze(event) {
    event?.preventDefault(); if (state.parsing || state.audioRunning) return;
    const info = refreshInput();
    if (!info) return setStatus('请粘贴有效的分享链接，或包含 http / https 链接的完整分享文案。', 'error');
    cancelAnalysis(); releaseLocal(); resetResult(); state.parsing = true; setControls();
    const serial = state.serial, controller = new AbortController(); state.parseAbort = controller;
    const timer = setTimeout(() => controller.abort(), info.platform === 'channels' ? 12 * 60 * 1000 : 180000);
    setStatus('正在解析' + (platforms[info.platform] || '') + '作品，请稍候…', 'busy');
    try {
      const response = await fetch('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageUrl: info.url }), signal: controller.signal });
      let result;
      if (info.platform === 'channels') {
        try {
          const start = await response.json();
          if (!start?.async || !start.jobId) { result = start?.error ? start : { error: '视频号会话创建失败，请重试。', reasonCode: 'CHANNELS_START_FAILED', platform: 'channels', candidates: [] }; }
          else {
            setStatus('视频号网页会话已创建，正在等待二维码…', 'busy'); $('channelsAuth').hidden = false;
            await fetch('/.netlify/functions/channels-job-background?job=' + encodeURIComponent(start.jobId), { method: 'POST', cache: 'no-store' }).catch(() => {});
            result = await waitForChannelsJob(start.jobId, serial, controller.signal);
          }
        } catch (error) { if (error.name === 'AbortError') throw error; throw error; }
      } else { try { result = await response.json(); } catch (_) { throw new Error('解析服务暂不可用，请稍后重试。'); } }
      if (serial !== state.serial) return;
      if (!response.ok && !result.error) result.error = '解析服务返回错误，请稍后重试。';
      applyResult(result);
    } catch (error) {
      if (serial === state.serial) setStatus(error.name === 'AbortError' ? '解析等待超时，请稍后重新尝试。' : error.message || '解析失败，请重新尝试。', 'error');
    } finally { clearTimeout(timer); if (serial === state.serial) { state.parsing = false; state.parseAbort = null; setControls(); } }
  }
  async function readMedia(item, signal, onProgress) {
    try { return await readResponse(await fetch(sourceURL(item), { signal, credentials: 'omit', mode: 'cors' }), item, onProgress); }
    catch (error) {
      if (error.name === 'AbortError' || error.limitExceeded) throw error;
      let endpoint = mediaURL(item, true);
      try { const supplied = new URL(item.serverDownloadUrl, location.origin); if (item.serverDownloadUrl && supplied.origin === location.origin && !supplied.username && !supplied.password) endpoint = supplied.href; } catch (_) {}
      return readResponse(await fetch(endpoint, { signal }), item, onProgress);
    }
  }
  async function readResponse(response, item, onProgress) {
    if (!response.ok) { let detail; try { detail = await response.json(); } catch (_) {} throw new Error(detail?.error || '源文件读取失败（HTTP ' + response.status + '），请重新解析。'); }
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_FILE) { const error = new Error('源文件超过 200 MB，请选择更小的素材。'); error.limitExceeded = true; throw error; }
    if (response.status === 206) {
      const match = String(response.headers.get('content-range') || '').match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (!match || Number(match[1]) !== 0 || Number(match[2]) + 1 !== Number(match[3])) throw new Error('来源返回了不完整的媒体片段，请重新解析。');
    }
    if (!response.body?.getReader) { const blob = await response.blob(); if (blob.size > MAX_FILE) { const error = new Error('源文件超过 200 MB。'); error.limitExceeded = true; throw error; } return verifyBlob(blob, item); }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_FILE) { await reader.cancel(); const error = new Error('源文件超过 200 MB，请选择更小的素材。'); error.limitExceeded = true; throw error; } chunks.push(value); onProgress?.(size, length); }
    } finally { reader.releaseLock(); }
    if (size < 32) throw new Error('没有读取到有效的素材文件，请重新解析。');
    if (length > 0 && size !== length) throw new Error('源文件读取不完整，请重新解析。');
    return verifyBlob(new Blob(chunks, { type: response.headers.get('content-type') || (item.kind === 'image' ? 'image/jpeg' : 'video/mp4') }), item);
  }
  async function verifyBlob(blob, item) {
    const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
    const video = ascii(4, 8) === 'ftyp' || bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    const image = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff || bytes[0] === 0x89 && ascii(1, 4) === 'PNG' || ascii(0, 3) === 'GIF' || ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    if (item.kind === 'image' ? !image : !video) throw new Error('来源未返回有效的媒体文件，请重新解析。');
    return blob;
  }
  function saveBlob(blob, name) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = safeName(name); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  async function downloadSelected() {
    const item = current(); if (!item || state.mismatch || state.downloadRunning || state.localFile) return;
    state.downloadRunning = true; setControls();
    try { $('downloadState').textContent = '正在读取素材文件…'; const blob = await readMedia(item, undefined, size => { $('downloadState').textContent = '正在读取素材 · ' + (size / 1048576).toFixed(1) + ' MB'; }); saveBlob(blob, filename(item)); $('downloadState').textContent = '文件已交给浏览器保存，请在下载列表确认。'; }
    catch (error) { $('downloadState').textContent = error.message; setStatus(error.message, 'error'); }
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
      const files = []; let size = 0;
      for (let i = 0; i < images.length; i++) { $('downloadState').textContent = '正在打包原图 ' + (i + 1) + ' / ' + images.length + '…'; const blob = await readMedia(images[i]); size += blob.size; if (size > MAX_FILE) throw new Error('整组图片超过 200 MB，请改为逐张保存。'); files.push({ name: String(i + 1).padStart(2, '0') + '-' + filename(images[i]), data: new Uint8Array(await blob.arrayBuffer()) }); }
      saveBlob(zipStore(files), safeName(selected.title || state.result.title || '原图素材') + '-原图.zip'); $('downloadState').textContent = '已将 ' + files.length + ' 张图片打包并交给浏览器保存，请查看下载列表。';
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
    state.result = { candidates: [item], platform: 'local' }; state.index = 0; 
    $('result').hidden = false; $('emptyPreview').hidden = true; $('sourceSelectWrap').hidden = true;
    $('sourceChip').textContent = '本地文件'; $('videoTitle').textContent = file.name; $('videoId').textContent = '设备内文件'; $('durationLabel').textContent = '视频时长'; $('duration').textContent = '—'; $('fileName').textContent = file.name; $('sourceUrl').textContent = '本地设备 · 不上传';
    $('previewWrap').hidden = false; $('imagePreviewWrap').hidden = true; $('audioBtn').hidden = false; $('downloadImagesBtn').hidden = true; $('frameBtn').hidden = false; $('downloadBtn').textContent = '已在本地';
    $('resultNote').textContent = '本地视频只在当前浏览器中处理。MP3 转换期间请保持这个网页开启。';
    $('preview').onloadedmetadata = () => { if (state.localFile === file) { item.duration = $('preview').duration; $('duration').textContent = seconds(item.duration); } };
    $('preview').onloadeddata = setControls; $('preview').onerror = () => { if (state.localFile === file) $('previewNotice').textContent = '当前浏览器可能不支持这个视频的预览编码，仍可尝试提取 MP3。'; };
    $('preview').src = state.localUrl; $('preview').load(); setStatus('本地视频已准备好，可以提取 MP3。', 'success'); setControls();
  }
  function finishAudio(message, error = false) { state.audioRunning = false; state.worker?.terminate(); state.worker = null; state.audioAbort = null; $('audioState').textContent = message; $('cancelAudioBtn').hidden = true; if (error) setStatus(message, 'error'); setControls(); }
  async function startAudio() {
    const item = current(); if (state.audioRunning || state.parsing || state.mismatch || item?.kind !== 'video') return;
    state.audioRunning = true; state.audioBlob = null; state.audioSerial++; const serial = state.audioSerial;
    $('audioTask').hidden = false; $('cancelAudioBtn').hidden = false; $('saveAudioBtn').hidden = true; $('audioProgress').value = 0; $('audioState').textContent = '正在准备源文件…'; setControls();
    try {
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
    state.audioSerial++; state.audioAbort?.abort(); state.worker?.terminate(); state.audioBlob = null; $('saveAudioBtn').hidden = true; finishAudio('MP3 任务已取消。');
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
  $('urlInput').addEventListener('input', () => { if (state.parsing) { cancelAnalysis(); setStatus('链接已更新，点击解析素材继续。'); } if ((state.result || state.failure) && !state.localFile) resetResult(); refreshInput(); });
  $('urlInput').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') analyze(event); });
  $('clearBtn').addEventListener('click', () => { cancelAnalysis(); $('urlInput').value = ''; if (!state.localFile) resetResult(); refreshInput(); $('urlInput').focus(); setStatus('输入已清空，粘贴一个作品链接开始。'); });
  $('pasteBtn').addEventListener('click', async () => { try { const text = await navigator.clipboard.readText(); if (!text.trim()) return setStatus('剪贴板为空，请先复制作品链接。', 'error'); $('urlInput').value = text.slice(0, 12000); $('urlInput').dispatchEvent(new Event('input')); $('urlInput').focus(); setStatus('已粘贴分享文案，点击解析素材继续。'); } catch (_) { $('urlInput').focus(); setStatus('无法读取剪贴板，请使用 Ctrl + V 粘贴链接。'); } });
  $('linkTab').addEventListener('click', () => changeTab(false)); $('localTab').addEventListener('click', () => changeTab(true));
  $('localFile').addEventListener('change', event => chooseFile(event.target.files?.[0]));
  $('fileDrop').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('localFile').click(); } });
  ['dragenter', 'dragover'].forEach(type => $('fileDrop').addEventListener(type, event => { event.preventDefault(); $('fileDrop').classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(type => $('fileDrop').addEventListener(type, event => { event.preventDefault(); $('fileDrop').classList.remove('dragging'); }));
  $('fileDrop').addEventListener('drop', event => chooseFile(event.dataTransfer.files?.[0]));
  $('parseRetryBtn').addEventListener('click', analyze);
  $('qualitySelect').addEventListener('change', () => { state.index = Number($('qualitySelect').value); renderCandidate(); });
  $('downloadBtn').addEventListener('click', downloadSelected); $('downloadImagesBtn').addEventListener('click', downloadImages); $('frameBtn').addEventListener('click', saveFrame);
  $('audioBtn').addEventListener('click', startAudio); $('localAudioBtn').addEventListener('click', startAudio); $('cancelAudioBtn').addEventListener('click', cancelAudio);
  $('saveAudioBtn').addEventListener('click', () => { if (!state.audioBlob) return; saveBlob(state.audioBlob, state.audioName); $('audioState').textContent = 'MP3 文件已交给浏览器保存，请在下载列表确认。'; });
  $('retryPreviewBtn').addEventListener('click', () => { if (state.localFile) { $('preview').load(); $('previewNotice').textContent = ''; } else renderCandidate(); });
  window.addEventListener('beforeunload', event => { if (state.audioRunning) { event.preventDefault(); event.returnValue = ''; } });
})();
