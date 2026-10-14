// Shared by the Node resolver and Netlify Edge media stream. No user cookies are forwarded.
const PAGE_HOSTS = new Set([
  'douyin.com', 'www.douyin.com', 'm.douyin.com', 'v.douyin.com',
  'iesdouyin.com', 'www.iesdouyin.com', 'm.iesdouyin.com',
  'xiaohongshu.com', 'www.xiaohongshu.com', 'm.xiaohongshu.com',
  'xhslink.com', 'www.xhslink.com',
  'bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv', 'www.b23.tv',
  'bili2233.cn', 'www.bili2233.cn'
]);
const MEDIA_SUFFIXES = [
  'douyinvod.com', 'douyinpic.com', 'bytecdn.cn', 'bytecdn.com',
  'ibytedtos.com', 'bytevcloud.com', 'pstatp.com', 'snssdk.com', 'zjcdn.com',
  'xhscdn.com', 'xhscdn.net', 'bilivideo.com', 'bilivideo.cn', 'hdslb.com',
  'finder.video.qq.com', 'finder.video.qq.com.cn', 'finder.video.tencent.com'
];
const DEMO_HOST = 'media.w3.org';
const DEMO_PATH = '/2010/05/sintel/trailer.mp4';
const MDN_HOST = 'interactive-examples.mdn.mozilla.net';
const MDN_PATH = '/media/cc0-videos/flower.mp4';
const MAX_URL = 16000;

export function isPublicIp(address) {
  const raw = String(address || '').toLowerCase().split('%')[0];
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIp(mapped[1]);
  if (raw.includes(':')) {
    // Only globally routable unicast space is accepted; mapped/private/link local are rejected.
    return /^[23][0-9a-f]{0,3}:/.test(raw) && !/^2001:(?:db8|0)(?::|$)/.test(raw);
  }
  const parts = raw.split('.').map(Number);
  if (parts.length !== 4 || parts.some((v, i) => !/^\d{1,3}$/.test(raw.split('.')[i]) || !Number.isInteger(v) || v > 255)) return false;
  const [a,b,c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127) return false;
  if (a === 192 && b === 0 || a === 192 && b === 2 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return false;
  return true;
}

export function parseSafeUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL) throw new Error('链接过长或格式无效。');
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的 HTTP 或 HTTPS 链接。'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || !url.hostname || url.hostname.endsWith('.')) throw new Error('链接协议、端口或认证信息不受支持。');
  if (url.hostname.includes(':') || /^[\d.]+$/.test(url.hostname)) throw new Error('不支持 IP 地址或本地网络链接。');
  url.hash = '';
  return url;
}

export function isMediaHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return MEDIA_SUFFIXES.some(suffix => host === suffix || host.endsWith('.' + suffix));
}

export function assertAllowedUrl(value, purpose = 'page') {
  const url = parseSafeUrl(value);
  const host = url.hostname.toLowerCase();
  const demo = host === DEMO_HOST && url.pathname === DEMO_PATH || host === MDN_HOST && url.pathname === MDN_PATH;
  if (purpose === 'media') {
    const douyinPlay = ['www.douyin.com', 'www.iesdouyin.com', 'www.snssdk.com', 'aweme.snssdk.com'].includes(host) && /^\/aweme\/v\d+\/(?:play|playwm)\/?$/i.test(url.pathname);
    if (!isMediaHost(host) && !demo && !douyinPlay) throw new Error('该媒体域名不在支持平台的公开 CDN 白名单内。');
    if (/\.(?:m3u8|mpd|m4s|ts|html?|js|css|json|zip|exe|apk)$/i.test(url.pathname)) throw new Error('该地址不是可直接保存的完整媒体文件。');
    const image = /\.(?:jpe?g|png|webp|gif|avif|heic|heif)$/i.test(url.pathname);
    if (!image) for (const key of url.searchParams.keys()) if (/^(?:range|byte_?start|byte_?end|start|end|segment|segment_index|chunk|chunk_index|part)$/i.test(key)) throw new Error('该地址指定了部分字节或分段，不能作为完整视频下载。');
  } else if (purpose === 'api') {
    if (host !== 'api.bilibili.com' || !/^\/x\/(?:player\/playurl|web-interface\/view)$/.test(url.pathname)) throw new Error('不支持此平台接口。');
  } else if (!PAGE_HOSTS.has(host) && !demo) {
    throw new Error('目前支持抖音、小红书、哔哩哔哩分享链接和支持平台的媒体直链。');
  }
  return url;
}

export function inferPurpose(value) {
  const url = parseSafeUrl(value);
  if (url.hostname === 'api.bilibili.com') return 'api';
  if (isMediaHost(url.hostname) || url.hostname === DEMO_HOST && url.pathname === DEMO_PATH || url.hostname === MDN_HOST && url.pathname === MDN_PATH) return 'media';
  return 'page';
}

export function safeFileName(value, extension = 'mp4') {
  const name = String(value || 'media').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 130) || 'media';
  const base = name.replace(/\.[a-z0-9]{2,6}$/i, '');
  const guarded = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(base) ? '_' + base : base;
  return guarded + '.' + extension;
}

export function mediaType(type, kind = 'video') {
  const mime = String(type || '').split(';')[0].trim().toLowerCase();
  const images = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif', 'image/avif':'avif', 'image/heic':'heic', 'image/heif':'heif' };
  const videos = { 'video/mp4':'mp4', 'video/webm':'webm', 'video/quicktime':'mov', 'video/x-m4v':'m4v' };
  const extension = kind === 'image' ? images[mime] : videos[mime];
  return extension ? { mime, extension } : null;
}

export function sniffMediaType(bytes, kind = 'video') {
  if (!bytes || bytes.length < 12) return null;
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start,end));
  const ftyp = ascii(4,8) === 'ftyp';
  const brand = ftyp ? ascii(8,12) : '';
  const imageBrands = /^(?:avif|avis|heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/;
  if (kind === 'image') {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime:'image/jpeg',extension:'jpg' };
    if ([137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) return { mime:'image/png',extension:'png' };
    if (/^GIF8[79]a$/.test(ascii(0,6))) return { mime:'image/gif',extension:'gif' };
    if (ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') return { mime:'image/webp',extension:'webp' };
    if (ftyp && /^(?:avif|avis)$/.test(brand)) return { mime:'image/avif',extension:'avif' };
    if (ftyp && imageBrands.test(brand)) return { mime:'image/heic',extension:'heic' };
    return null;
  }
  if (ftyp && !imageBrands.test(brand)) {
    const size = (bytes[0] * 0x1000000 + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]) >>> 0;
    if (size >= 16 && size <= 4096) return { mime:brand === 'qt  ' ? 'video/quicktime' : 'video/mp4', extension:brand === 'qt  ' ? 'mov' : 'mp4' };
  }
  if ([0x1a,0x45,0xdf,0xa3].every((n,i) => bytes[i] === n)) return { mime:'video/webm',extension:'webm' };
  return null;
}

export function platformOf(value) {
  const host = parseSafeUrl(value).hostname;
  if (host === 'weixin.qq.com' || host === 'channels.weixin.qq.com' || host === 'wx.qq.com') return 'channels';
  if (host === 'douyin.com' || host.endsWith('.douyin.com') || host === 'iesdouyin.com' || host.endsWith('.iesdouyin.com')) return 'douyin';
  if (host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com') || host === 'xhslink.com' || host.endsWith('.xhslink.com')) return 'xiaohongshu';
  if (host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'b23.tv' || host === 'bili2233.cn') return 'bilibili';
  return 'direct';
}
