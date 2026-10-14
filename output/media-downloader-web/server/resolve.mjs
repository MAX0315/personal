import LinkResolver from './link-resolver.cjs';
import Bili from './bilibili.cjs';
import { safeFetch, boundedText } from './safe-fetch.mjs';
import { parseSafeUrl, assertAllowedUrl, platformOf, safeFileName } from './policy.mjs';

export function extractInputUrl(value) {
  if (typeof value !== 'string' || value.length > 20000) throw new Error('请粘贴有效的分享链接或分享文案。');
  const match = value.match(/https?:\/\/[^\s<>"“”]+/i);
  if (!match) throw new Error('分享内容中没有完整的 HTTP 或 HTTPS 链接。');
  return parseSafeUrl(match[0].replace(/[，。；！）)]+$/, '')).href;
}

async function publicBilibiliApi(url, pageUrl, transport) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await transport(url, { purpose:'api', referrer:pageUrl, signal:controller.signal });
    if (!response.ok) return null;
    const text = await boundedText(response, 1024 * 1024);
    const payload = JSON.parse(text);
    return payload?.code === 0 ? payload : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function resolveBilibili(pageUrl, resolver, transport) {
  let result = await resolver.resolveBilibili(pageUrl);
  const bvid = result.bvid || Bili.getBvid(pageUrl), aid = result.aid || Bili.getAid(pageUrl);
  if ((!result.cid || !result.videoId) && (bvid || aid)) {
    const endpoint = new URL('https://api.bilibili.com/x/web-interface/view');
    endpoint.searchParams.set(bvid ? 'bvid' : 'aid', bvid || aid);
    const data = (await publicBilibiliApi(endpoint.href, pageUrl, transport))?.data;
    const selected = data?.pages?.find(item => Number(item.page) === Bili.getPage(pageUrl)) || data?.pages?.[0];
    if (data && (!bvid || String(data.bvid).toLowerCase() === bvid.toLowerCase()) && (!aid || String(data.aid) === aid)) {
      result = { ...result, bvid:data.bvid || bvid, aid:String(data.aid || aid), cid:String(selected?.cid || data.cid || ''), videoId:data.bvid || String(data.aid || aid), title:String(data.title || result.title || '哔哩哔哩视频'), duration:Number(selected?.duration || data.duration) || 0, pageUrl };
    }
  }
  let candidates = result.candidates || [], usedQuality = 0;
  for (const quality of [80,64,32,16]) {
    if (candidates.length || !result.cid || !result.videoId) break;
    const apiUrl = Bili.buildPlayUrl(result, quality);
    candidates = Bili.candidatesFromApi(await publicBilibiliApi(apiUrl, result.pageUrl || pageUrl, transport), result);
    if (candidates.length) usedQuality = quality;
  }
  return { ...result, candidates, platform:'bilibili', ...(usedQuality ? { method:'playurl-mp4' } : {}) };
}

function cleanCandidates(candidates) {
  return (Array.isArray(candidates) ? candidates : []).slice(0,80).flatMap(item => {
    try {
      const videoUrl = assertAllowedUrl(item.videoUrl || item.imageUrl, 'media').href;
      if (item.encrypted || item.decodeKey || /dash|hls|mpegurl/i.test(item.kind || '')) return [];
      const image = item.kind === 'image';
      const ext = String(item.fileName || new URL(videoUrl).pathname).match(/\.(mp4|webm|mov|m4v|jpe?g|png|webp|gif|avif|heic|heif)$/i)?.[1]?.toLowerCase() || (image ? 'jpg' : 'mp4');
      return [{ ...item, videoUrl, kind:image ? 'image' : 'video', fileName:safeFileName(item.fileName || item.title || 'media', ext === 'jpeg' ? 'jpg' : ext) }];
    } catch { return []; }
  });
}

export async function resolveInput(payload, { transport = safeFetch } = {}) {
  const pageUrl = extractInputUrl(payload?.pageUrl);
  const platform = platformOf(pageUrl);
  if (platform === 'channels') return { error:'视频号链接需要你在 Chrome 内正常登录腾讯网页账号。连接 Chrome 插件后可在此网页调用浏览器中的解析和下载，服务器无法代用你的登录状态。', needsBridge:true, requiresPage:true, platform, pageUrl };
  const purpose = (() => { try { assertAllowedUrl(pageUrl, 'media'); return 'media'; } catch { return 'page'; } })();
  assertAllowedUrl(pageUrl, purpose);
  let result;
  if (purpose === 'media') {
    const image = /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(new URL(pageUrl).pathname);
    result = { candidates:[{ videoUrl:pageUrl, kind:image ? 'image' : 'video', source:'DIRECT', title:'媒体直链', fileName:decodeURIComponent(new URL(pageUrl).pathname.split('/').pop() || 'media.mp4') }], pageUrl, platform:'direct', method:'link' };
  } else {
    // Per-request transport prevents concurrent calls from sharing a mutable global fetch.
    const resolver = LinkResolver.createResolver(transport);
    result = platform === 'douyin' ? await resolver.resolveDouyin(pageUrl) : platform === 'bilibili' ? await resolveBilibili(pageUrl, resolver, transport) : await resolver.resolveGeneric(pageUrl);
  }
  const candidates = cleanCandidates(result.candidates);
  if (!candidates.length) {
    const detail = result.reason || (platform === 'bilibili' ? 'B 站未返回单文件 MP4，可能提供分离流或受登录、地区、会员限制。' : '公开页面未提供目标作品的完整媒体地址。');
    const recovery = platform === 'douyin'
      ? ' 连接 Chrome 插件后，浏览器会加载目标作品并读取播放信息。抖音页面要求登录或验证时，请正常完成后重试。'
      : ' 需要登录或页面播放时，可连接 Chrome 插件并重新解析。';
    return { error:detail + recovery, needsBridge:true, requiresPage:true, platform, pageUrl:result.pageUrl || pageUrl, videoId:result.videoId || '' };
  }
  return { ...result, candidates, platform:result.platform || platform, pageUrl:result.pageUrl || pageUrl, matched:true, verifiedMedia:false };
}
