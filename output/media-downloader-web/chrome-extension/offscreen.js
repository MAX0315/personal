/* The offscreen document owns downloads and Blob URLs until Chrome finishes saving. */
(() => {
  'use strict';
  const MAX_BYTES = 200 * 1024 * 1024;
  const FETCH_TIMEOUT = 180000;
  const CONVERT_TIMEOUT = 10 * 60 * 1000;
  const jobs = new Map();

  function notify(message) {
    chrome.runtime.sendMessage(message).catch(() => {});
  }

  function progress(job, phase, percent, detail) {
    if (!jobs.has(job.id) || job.cancelled) return;
    job.lastProgress = { type: 'audioProgress', jobId: job.id, phase, percent, detail };
    notify(job.lastProgress);
  }

  function dispose(job) {
    job.cancelled = true;
    clearTimeout(job.timer);
    clearInterval(job.heartbeat);
    job.controller.abort();
    if (job.worker) job.worker.terminate();
    if (job.blobUrl) URL.revokeObjectURL(job.blobUrl);
    jobs.delete(job.id);
  }

  function fail(job, error) {
    if (!jobs.has(job.id) || job.cancelled) return;
    dispose(job);
    notify({ type: 'audioFailed', jobId: job.id, error });
  }

  async function fetchMedia(job, videoUrl) {
    job.timer = setTimeout(() => fail(job, '读取视频超时，请重新解析链接后再试。'), FETCH_TIMEOUT);
    progress(job, 'fetching', 0, '正在读取完整视频，提取其中的原始音轨…');
    const response = await fetch(videoUrl, {
      signal: job.controller.signal, credentials: 'include', redirect: 'follow', cache: 'no-store'
    });
    if (!response.ok) throw new Error(`视频服务器返回 HTTP ${response.status}，请重新解析链接。`);
    if (response.status === 206) {
      const range = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get('content-range') || '');
      if (!range || +range[1] !== 0 || +range[2] + 1 !== +range[3]) {
        throw new Error('服务器只返回了部分视频，无法生成完整 MP3，请重新解析。');
      }
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (/text\/|json|mpegurl|dash\+xml/.test(contentType)) {
      throw new Error('返回内容不是完整视频文件，可能需要登录或链接已经失效。');
    }
    const total = Number(response.headers.get('content-length')) || 0;
    if (total > MAX_BYTES) throw new Error('视频超过 200 MB 本地 MP3 转换上限，请下载视频后用桌面工具转换。');
    if (!response.body) throw new Error('视频响应为空，请重新解析链接。');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    let lastUpdate = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (job.cancelled) throw new Error('已取消');
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new Error('视频超过 200 MB 本地 MP3 转换上限，请下载视频后用桌面工具转换。');
      }
      chunks.push(value);
      const now = Date.now();
      if (now - lastUpdate > 250) {
        lastUpdate = now;
        progress(job, 'fetching', total ? Math.min(100, Math.round(bytes / total * 100)) : null,
          `已读取 ${(bytes / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}`);
      }
    }
    clearTimeout(job.timer);
    if (!bytes) throw new Error('视频文件为空，无法提取音频。');
    if (total && bytes < total) throw new Error('视频下载不完整，请重试。');
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    return buffer.buffer;
  }

  async function convert(job, request) {
    try {
      const input = await fetchMedia(job, request.videoUrl);
      if (job.cancelled) return;
      progress(job, 'preparing', 0, '正在加载插件内置的本地 MP3 转换引擎…');
      const worker = new Worker(chrome.runtime.getURL('audio-worker.js'));
      job.worker = worker;
      job.timer = setTimeout(() => fail(job, '本地 MP3 转换超过 10 分钟，已停止。请下载视频后使用桌面工具转换。'), CONVERT_TIMEOUT);
      worker.onerror = () => fail(job, '本地转换引擎启动失败或内存不足，请重新加载插件后再试。');
      worker.onmessage = ({ data }) => {
        if (job.cancelled || !jobs.has(job.id)) return;
        if (data.type === 'progress') progress(job, data.phase, data.percent, data.detail);
        if (data.type === 'failed') fail(job, data.error);
        if (data.type === 'ready') {
          clearTimeout(job.timer);
          worker.terminate();
          job.worker = null;
          job.blobUrl = URL.createObjectURL(new Blob([data.buffer], { type: 'audio/mpeg' }));
          progress(job, 'saving', 100, 'MP3 已转换完成，正在交给 Chrome 保存…');
          notify({ type: 'audioReady', jobId: job.id, blobUrl: job.blobUrl, filename: job.filename, bytes: data.buffer.byteLength });
        }
      };
      worker.postMessage({ type: 'convert', input, duration: request.duration }, [input]);
    } catch (error) {
      fail(job, error && error.message ? error.message : '读取或转换视频失败，请重新解析链接。');
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== 'offscreen') return;
    // Background service workers may omit sender.url; content scripts always have sender.tab.
    if (sender.id !== chrome.runtime.id || sender.tab ||
        (sender.url && sender.url !== chrome.runtime.getURL('background.js'))) return;
    if (!['convertAudio', 'cancelAudio', 'releaseAudio'].includes(message.type)) return;
    const id = typeof message.jobId === 'string' ? message.jobId.slice(0, 160) : '';
    if (!id) { sendResponse({ ok: false, error: '缺少音频任务编号。' }); return; }
    if (message.type === 'cancelAudio' || message.type === 'releaseAudio') {
      const job = jobs.get(id);
      if (job) dispose(job);
      sendResponse({ ok: true });
      return;
    }
    let url;
    try { url = new URL(message.videoUrl); } catch (_) { /* rejected below */ }
    if (!url || !['http:', 'https:'].includes(url.protocol)) {
      sendResponse({ ok: false, error: '视频地址无效，请重新解析。' }); return;
    }
    if (jobs.has(id)) { sendResponse({ ok: true, jobId: id }); return; }
    if (jobs.size) { sendResponse({ ok: false, error: '已有 MP3 任务进行中，请等待或取消后重试。' }); return; }
    const filename = (String(message.filename || '视频音频').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\.(mp3|mp4|webm|mov|m4a|aac)$/i, '').replace(/[. ]+$/g, '').slice(0, 160) || '视频音频') + '.mp3';
    const job = { id, filename, controller: new AbortController(), cancelled: false, timer: null, worker: null, blobUrl: null };
    jobs.set(id, job);
    job.heartbeat = setInterval(() => {
      if (jobs.has(job.id) && !job.cancelled && job.lastProgress) notify(job.lastProgress);
    }, 10000);
    sendResponse({ ok: true, jobId: id });
    void convert(job, message);
  });
})();
