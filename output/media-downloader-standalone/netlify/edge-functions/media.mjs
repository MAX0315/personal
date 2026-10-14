import { assertAllowedUrl, isPublicIp, mediaType, sniffMediaType, safeFileName } from '../../server/policy.mjs';

export const config = { path:'/api/media', cache:'manual' };
const FAIL_HEADERS = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' };
function fail(error, status = 400) { return new Response(JSON.stringify({ error }), { status, headers:FAIL_HEADERS }); }

async function peekAndRestore(body) {
  if (!body) throw new Error('平台媒体内容为空。');
  const reader = body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (bytes < 32) { const chunk = await reader.read(); if (chunk.done) break; chunks.push(chunk.value); bytes += chunk.value.byteLength; }
    const prefix = new Uint8Array(Math.min(bytes,32));
    let written = 0;
    for (const chunk of chunks) { const part = chunk.slice(0,prefix.length - written); prefix.set(part,written); written += part.length; if (written === prefix.length) break; }
    const stream = new ReadableStream({
      start(controller) { for (const chunk of chunks) controller.enqueue(chunk); },
      async pull(controller) { try { const chunk = await reader.read(); if (chunk.done) controller.close(); else controller.enqueue(chunk.value); } catch (error) { controller.error(error); } },
      async cancel(reason) { await reader.cancel(reason); }
    });
    return { prefix, stream };
  } catch (error) { await reader.cancel(); throw error; }
}

export async function handleMedia(request, { transport = fetch, resolveDns } = {}) {
  if (!['GET','HEAD'].includes(request.method)) return fail('媒体地址只支持 GET 或 HEAD 请求。', 405);
  const query = new URL(request.url).searchParams;
  const kind = query.get('kind') === 'image' ? 'image' : 'video';
  const incomingRange = request.headers.get('range');
  if (incomingRange && !/^bytes=\d*-\d*$/.test(incomingRange)) return fail('仅支持单段字节范围。', 416);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    let target = query.get('url') || '', hops = 0;
    const upstreamHeaders = new Headers({ 'Accept':'*/*', 'Accept-Encoding':'identity', 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
    if (incomingRange) upstreamHeaders.set('Range', incomingRange);
    let response;
    while (true) {
      const url = assertAllowedUrl(target, 'media');
      // Fixed, provider-owned CDN domains also constrain DNS rebinding when Edge DNS is unavailable.
      if (resolveDns) {
        const addresses = await resolveDns(url.hostname);
        if (!addresses.length || addresses.some(address => !isPublicIp(address))) throw new Error('媒体域名未解析到公开网络地址。');
      }
      if (url.hostname.endsWith('.bilivideo.com') || url.hostname.endsWith('.bilivideo.cn') || url.hostname.endsWith('.hdslb.com')) upstreamHeaders.set('Referer','https://www.bilibili.com/');
      else if (url.hostname.endsWith('.xhscdn.com') || url.hostname.endsWith('.xhscdn.net')) upstreamHeaders.set('Referer','https://www.xiaohongshu.com/');
      else upstreamHeaders.delete('Referer');
      response = await transport(url.href, { method:request.method, redirect:'manual', headers:upstreamHeaders, signal:controller.signal });
      if (![301,302,303,307,308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || hops++ >= 5) throw new Error('媒体重定向地址无效或次数过多。');
      target = new URL(location, url).href;
    }
    if (response.status === 416) { await response.body?.cancel(); return fail('媒体范围无效，请重新解析后重试。', 416); }
    if (![200,206].includes(response.status)) { await response.body?.cancel(); return fail(response.status === 403 || response.status === 401 ? '平台拒绝了该地址，可能已过期或需要访问权限。请重新解析后重试。' : '平台媒体读取失败（' + response.status + '）。', 502); }
    const isDownload = query.get('download') === '1';
    const contentRange = response.headers.get('content-range') || '';
    if (isDownload && !incomingRange && (response.status === 206 || contentRange)) { await response.body?.cancel(); return fail('平台只返回了部分视频字节，已停止保存不完整文件。请重新解析。', 422); }
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    let type = mediaType(mime, kind), body = response.body;
    if (!type && mime && mime !== 'application/octet-stream' && mime !== 'binary/octet-stream') { await body?.cancel(); return fail(kind === 'image' ? '平台返回的内容不是支持的图片格式，已停止下载。' : '平台返回的内容不是单文件视频；可能是错误页、图片或分离流，已停止下载。', 422); }
    // Read only the bounded container prefix, then stream the same bytes back to the client.
    // A nonzero or suffix preview Range intentionally starts inside a verified file container.
    const startsAtZero = !incomingRange || /^bytes=0-\d*$/.test(incomingRange);
    if (request.method !== 'HEAD' && startsAtZero) {
      const peeked = await peekAndRestore(body);
      const detected = sniffMediaType(peeked.prefix, kind);
      if (!detected) { await peeked.stream.cancel(); return fail('平台响应没有有效的媒体文件头，已停止下载。', 422); }
      if (type && type.mime !== detected.mime && !(type.mime === 'video/x-m4v' && detected.mime === 'video/mp4')) { await peeked.stream.cancel(); return fail('媒体文件头与平台声明的格式不一致，已停止下载。', 422); }
      type = detected; body = peeked.stream;
    }
    if (!type) { await body?.cancel(); return fail('平台未返回可验证的媒体格式，请重新解析。', 422); }
    const headers = new Headers({ 'Content-Type':type.mime, 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' });
    for (const name of ['Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified']) if (response.headers.has(name)) headers.set(name, response.headers.get(name));
    if (isDownload) {
      const filename = safeFileName(query.get('filename') || 'media', type.extension);
      headers.set('Content-Disposition', 'attachment; filename="media.' + type.extension + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename));
    }
    return new Response(body, { status:response.status, headers });
  } catch (error) { return fail(controller.signal.aborted ? '媒体读取超时，请重新解析后重试。' : error?.message || '媒体读取失败。'); }
  finally { clearTimeout(timeout); }
}

async function edgeDns(host) {
  const lookups = await Promise.allSettled(['A','AAAA'].map(type => Deno.resolveDns(host, type)));
  return lookups.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

export default request => handleMedia(request, { resolveDns:typeof Deno !== 'undefined' && typeof Deno.resolveDns === 'function' ? edgeDns : undefined });
