/* A dedicated classic worker keeps the offscreen runtime responsive while WASM runs. */
'use strict';
importScripts('vendor/ffmpeg/ffmpeg-core.js');

function emitProgress(phase, percent, detail) {
  self.postMessage({ type: 'progress', phase, percent, detail });
}

self.onmessage = async ({ data }) => {
  if (!data || data.type !== 'convert') return;
  self.onmessage = null;
  const expectedDuration = Number(data.duration) > 0 ? Number(data.duration) : 0;
  const log = [];
  let sourceDuration = 0;
  let sawInput = false;
  let hasAudio = false;
  let lastPercent = -1;
  try {
    const coreURL = new URL('vendor/ffmpeg/ffmpeg-core.js', self.location.href).href;
    const wasmURL = new URL('vendor/ffmpeg/ffmpeg-core.wasm', self.location.href).href;
    const core = await createFFmpegCore({ mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL }))}` });
    core.setLogger(({ message }) => {
      log.push(message);
      if (log.length > 24) log.shift();
      if (/Input #0/.test(message)) sawInput = true;
      if (/Output #0/.test(message)) sawInput = false;
      const match = sawInput && /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
      if (match) sourceDuration = +match[1] * 3600 + +match[2] * 60 + +match[3];
      if (sawInput && /Stream #0:.*Audio:/.test(message)) hasAudio = true;
    });
    core.setProgress(({ progress, time }) => {
      const denominator = sourceDuration || expectedDuration;
      const ratio = denominator && Number.isFinite(time) ? time / 1000000 / denominator : progress;
      const percent = Math.max(0, Math.min(99, Math.floor((ratio || 0) * 100)));
      if (percent !== lastPercent) {
        lastPercent = percent;
        emitProgress('converting', percent, `正在本地转换 MP3… ${percent}%`);
      }
    });
    core.FS.writeFile('input.media', new Uint8Array(data.input));
    data.input = null;
    // Probe without producing an output, then reject a known preview/truncated source.
    core.setTimeout(30000);
    core.exec('-hide_banner', '-i', 'input.media');
    core.reset();
    if (!hasAudio) throw new Error('这个视频没有可提取的音轨，无法生成 MP3。');
    if (sourceDuration && expectedDuration && Math.abs(sourceDuration - expectedDuration) > Math.max(2, expectedDuration * 0.04)) {
      throw new Error(`获取到的视频为 ${sourceDuration.toFixed(1)} 秒，与作品的 ${expectedDuration.toFixed(1)} 秒不一致，已停止转换以免保存试听片段或错误素材。请重新解析。`);
    }
    emitProgress('converting', 0, '正在本地转换为 192 kbps MP3，关闭弹窗后仍会继续…');
    core.setTimeout(9 * 60 * 1000);
    const code = core.exec('-hide_banner', '-i', 'input.media', '-map', '0:a:0', '-vn', '-sn', '-dn',
      '-c:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '3', '-f', 'mp3', 'output.mp3');
    if (code !== 0) throw new Error('MP3 转换失败，视频可能不完整、音轨不受支持或超过转换时限。');
    const output = core.FS.readFile('output.mp3');
    if (output.length < 128) throw new Error('未生成有效的 MP3 音频，请重新解析视频。');
    // FS returns a separate Uint8Array; transfer ownership and release the WASM worker.
    self.postMessage({ type: 'ready', buffer: output.buffer }, [output.buffer]);
    core.FS.unlink('input.media');
    core.FS.unlink('output.mp3');
  } catch (error) {
    let message = error && error.message ? error.message : '本地 MP3 转换失败。';
    if (/memory|OOM|out of bounds|Aborted/i.test(message)) message = '浏览器可用内存不足，已停止 MP3 转换。请下载视频后使用桌面工具转换。';
    self.postMessage({ type: 'failed', error: message });
  }
};
