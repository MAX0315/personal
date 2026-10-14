import X from './xhs-extractor.cjs';
import { inspectMp4 } from './mp4.mjs';

export const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PAGE_HOSTS = new Set(['xhslink.cn', 'www.xhslink.cn', 'xhslink.com', 'www.xhslink.com', 'xiaohongshu.com', 'www.xiaohongshu.com', 'm.xiaohongshu.com']);
const MAX_MEDIA = 80 * 1024 * 1024;
const MAX_HTML = 12 * 1024 * 1024;
export function inputUrl(input) {
  if (typeof input !== 'string' || input.length > 20000) throw new Error('请粘贴有效的分享内容。');
  const raw = input.match(/https?:\/\/[^\s<>"“”]+/i)?.[0]?.replace(/[，。；！）)]+$/, '');
  if (!raw) throw new Error('分享内容中没有完整链接。');
  return new URL(raw);
}
export function isXhsInput(input) {
  try { return PAGE_HOSTS.has(inputUrl(input).hostname); } catch { return false; }
}
function allowedUrl(value, kind) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) throw new Error('分享地址格式不受支持。');
  const allowed = kind === 'page' ? PAGE_HOSTS.has(url.hostname) : /^sns-(?:video(?:-[a-z0-9]+)*|bak-v\d+)\.xhscdn\.com$/i.test(url.hostname);
  if (!allowed) throw new Error('平台重定向到了不受支持的地址。');
  // Official mobile share pages currently return HTTP CDN URLs; use TLS.
  url.protocol = 'https:';
  return url;
}
async function boundedBytes(response, maximum) {
  if (!response.ok) { await response.body?.cancel(); throw new Error('小红书公开内容暂时无法读取。'); }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maximum) { await response.body?.cancel(); throw new Error('文件超过当前可保存的大小上限。'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('平台未返回内容。');
  const parts = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('文件超过当前可保存的大小上限。');
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (declared && !response.headers.get('content-encoding') && size !== declared) throw new Error('平台文件未完整接收，请重新提取。');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
export async function officialFetch(value, kind, { transport = fetch, signal } = {}) {
  let url = allowedUrl(value, kind);
  for (let hop = 0; hop < 7; hop++) {
    const response = await transport(url.href, { redirect: 'manual', signal, headers: { 'User-Agent': MOBILE_UA, Accept: kind === 'page' ? 'text/html' : '*/*', 'Accept-Encoding': 'identity' } });
    if (![301,302,303,307,308].includes(response.status)) return { response, url: url.href };
    const location = response.headers.get('location'); await response.body?.cancel();
    if (!location) throw new Error('分享跳转缺少目标地址。');
    // Keep the complete official query, including xsec_token and app_share.
    url = allowedUrl(new URL(location, url).href, kind);
  }
  throw new Error('分享链接跳转次数过多。');
}
function noteText(html, noteId) {
  for (const match of html.matchAll(/(?:window\s*\.\s*)?__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/g)) {
    const state = X.parseState(match[1].trim().replace(/;$/, ''));
    const note = state?.noteData?.data?.noteData || state?.note?.noteDetailMap?.[noteId]?.note;
    if (note && (note.noteId || note.note_id || note.id) === noteId) return typeof note.desc === 'string' ? note.desc : '';
  }
  return '';
}
export async function resolveXhs(input, { transport = fetch, signal } = {}) {
  const original = allowedUrl(inputUrl(input).href, 'page');
  const expectedId = X.getNoteId(original.href);
  const page = await officialFetch(original.href, 'page', {transport, signal});
  const noteId = X.getNoteId(page.url);
  if (!noteId || expectedId && noteId !== expectedId) throw new Error('官方分享页没有返回目标笔记，请在小红书重新复制分享链接。');
  const html = new TextDecoder().decode(await boundedBytes(page.response, MAX_HTML));
  const parsed = X.extractFromHtml(html, page.url);
  if (parsed.noteId !== noteId || !parsed.candidates.length) throw new Error('小红书公开分享页暂未提供可保存的视频。');
  // Prefer the official H.264 rendition so preview also works on more browsers.
  const candidates = [...parsed.candidates].sort((a,b) => Number(b.codec === 'h264') - Number(a.codec === 'h264'));
  for (const candidate of candidates.slice(0, 6)) {
    try {
      const media = await officialFetch(candidate.videoUrl, 'media', {transport, signal});
      if (media.response.status !== 200) { await media.response.body?.cancel(); continue; }
      const bytes = await boundedBytes(media.response, MAX_MEDIA);
      const info = inspectMp4(bytes);
      if (candidate.duration && Math.abs(info.duration - candidate.duration) > Math.max(2, candidate.duration * 0.03)) throw new Error('视频时长与目标笔记不一致。');
      const videoCodec = {avc1:'h264',avc3:'h264',hvc1:'h265',hev1:'h265'}[info.videoCodec] || info.videoCodec;
      return { bytes, candidate: {kind:'video', title:parsed.title, fileName:candidate.fileName, bytes:bytes.byteLength, format:'mp4', duration:info.duration, width:info.width, height:info.height, videoCodec, audioCodec:info.audioCodec === 'mp4a' ? 'aac' : info.audioCodec, hasAudio:info.hasAudio}, title:parsed.title, contentText:noteText(html,noteId), videoId:noteId, pageUrl:original.href, platform:'xiaohongshu', verifiedFile:true, verification:'container-and-length', method:'official-mobile-share' };
    } catch (error) { if (signal?.aborted) throw error; }
  }
  throw new Error('官方视频地址暂时无法完整读取，请稍后重新提取。');
}
