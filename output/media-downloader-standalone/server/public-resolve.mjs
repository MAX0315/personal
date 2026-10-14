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
  const requestedPage = Bili.getPage(pageUrl);
  if ((requestedPage > 1 || !result.cid || !result.videoId) && (bvid || aid)) {
    const endpoint = new URL('https://api.bilibili.com/x/web-interface/view');
    endpoint.searchParams.set(bvid ? 'bvid' : 'aid', bvid || aid);
    const data = (await publicBilibiliApi(endpoint.href, pageUrl, transport))?.data;
    const selected = data?.pages?.find(item => Number(item.page) === requestedPage) || (requestedPage === 1 ? data?.pages?.[0] : undefined);
    if (data && (!bvid || String(data.bvid).toLowerCase() === bvid.toLowerCase()) && (!aid || String(data.aid) === aid)) {
      if (requestedPage > 1 && !selected) return { ...result, candidates:[], cid:'', invalidPage:true, reason:'链接指定的 B 站分集不存在，已停止解析以避免保存其他分集。', requiresPage:true };
      const selectedCid = String(selected?.cid || data.cid || '');
      result = { ...result, candidates:result.cid === selectedCid ? result.candidates : [], bvid:data.bvid || bvid, aid:String(data.aid || aid), cid:selectedCid, videoId:data.bvid || String(data.aid || aid), title:String(data.title || result.title || '哔哩哔哩视频'), duration:Number(selected?.duration || data.duration) || 0, pageUrl };
    } else if (requestedPage > 1) {
      return { ...result, candidates:[], cid:'', reason:'平台未返回该 B 站分集的可核验信息，请重试。', requiresPage:true };
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
  if (platform === 'channels') return { error:'这个视频号分享页未向当前网站提供完整播放源，可能需要平台账号权限或只能在平台客户端观看。', requiresLogin:true, permissionRequired:true, platform, pageUrl };
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
    return { error:detail, requiresPage:true, invalidPage:result.invalidPage || undefined, platform, pageUrl:result.pageUrl || pageUrl, videoId:result.videoId || '' };
  }
  return { ...result, candidates, platform:result.platform || platform, pageUrl:result.pageUrl || pageUrl, matched:true, verifiedMedia:false };
}
