import { inputUrl, MOBILE_UA } from './xhs.mjs';

const HOSTS = new Set(['v.douyin.com','www.douyin.com','douyin.com','m.douyin.com','www.iesdouyin.com','iesdouyin.com']);
function officialUrl(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || !HOSTS.has(url.hostname)) throw new Error('抖音分享链接跳转异常，请在抖音重新复制分享链接。');
  url.protocol = 'https:';
  return url;
}
function identity(url) {
  const route = /^\/(?:share\/)?(video|note|slides)\/(\d{8,24})\/?$/.exec(url.pathname);
  if (!route) return null;
  // A path ID denotes the shared work. Refuse conflicting query identities.
  for (const key of ['modal_id','aweme_id','item_id']) {
    for (const value of url.searchParams.getAll(key)) if (value && value !== route[2]) throw new Error('抖音作品标识不一致，请重新复制分享链接。');
  }
  return {videoId:route[2],type:route[1] === 'video' ? 'video' : 'note'};
}

/** Resolve only official short-link redirects, before starting the browser job. */
export async function resolveDouyinShortLink(input, {transport=fetch,signal}={}) {
  let original;
  try {original=inputUrl(input);} catch {return null;}
  if (original.hostname !== 'v.douyin.com') return null;
  let url=officialUrl(original.href);
  if (!/^\/[A-Za-z\d_-]{5,64}\/?$/.test(url.pathname)) throw new Error('抖音短链接格式无效，请重新复制分享链接。');
  const deadline=AbortSignal.timeout(8000);
  const combined=signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal,deadline]) : deadline;
  const visited=new Set();
  try {
    for (let hop=0;hop<5;hop++) {
      if (visited.has(url.href)) throw new Error('抖音分享链接出现循环跳转，请重新复制。');
      visited.add(url.href);
      const response=await transport(url.href,{redirect:'manual',signal:combined,headers:{'User-Agent':MOBILE_UA,Accept:'text/html','Accept-Encoding':'identity'}});
      const location=response.headers.get('location');
      await response.body?.cancel();
      if (![301,302,303,307,308].includes(response.status) || !location) throw new Error('抖音短链接暂未返回作品地址，请稍后重试或粘贴完整作品链接。');
      url=officialUrl(new URL(location,url).href);
      const target=identity(url);
      if (target) {
        // The official redirect has confirmed the exact ID. Navigate directly
        // to its desktop work page instead of waiting on the short share page.
        return {...target,canonicalUrl:`https://www.douyin.com/${target.type}/${target.videoId}`};
      }
    }
    throw new Error('抖音分享链接跳转次数过多，请重新复制。');
  } catch(error) {
    if (combined.aborted) throw new Error('抖音短链接解析超时，请稍后重试或粘贴完整作品链接。');
    throw error;
  }
}
