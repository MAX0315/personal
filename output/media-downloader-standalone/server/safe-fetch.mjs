import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { assertAllowedUrl, inferPurpose, isPublicIp } from './policy.mjs';

export const MAX_TEXT_BYTES = 12 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function pinnedRequest(url, options, address) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, {
      method: options.method || 'GET',
      headers: options.headers,
      signal: options.signal,
      agent: false,
      lookup: (_host, opts, callback) => opts?.all ? callback(null, [address]) : callback(null, address.address, address.family),
      timeout: 10000
    }, res => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.headers)) if (value !== undefined && key !== 'set-cookie') headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
      const noBody = (options.method || 'GET') === 'HEAD' || [204,304].includes(res.statusCode);
      const response = new Response(noBody ? null : Readable.toWeb(res), { status: res.statusCode, headers });
      Object.defineProperty(response, 'url', { value: url.href });
      resolve(response);
    });
    req.on('timeout', () => req.destroy(new Error('平台连接超时，请稍后重试。')));
    req.on('error', reject);
    req.end();
  });
}

export function createSafeFetch({ lookupFn = dnsLookup, requestFn = pinnedRequest } = {}) {
  return async function safeFetch(value, options = {}) {
    let target = String(value), hops = 0;
    const purpose = options.purpose || inferPurpose(target);
    const headers = { 'User-Agent': UA, 'Accept': purpose === 'media' ? '*/*' : 'text/html,application/json;q=0.9,*/*;q=0.5', 'Accept-Encoding': 'identity' };
    // Only our own generated referrers can be sent upstream, never caller cookies or auth.
    if (options.referrer) { const ref = assertAllowedUrl(options.referrer, 'page'); headers.Referer = ref.href; }
    while (true) {
      const url = assertAllowedUrl(target, purpose);
      const addresses = await lookupFn(url.hostname, { all: true, verbatim: true });
      if (!addresses.length || addresses.some(item => !isPublicIp(item.address))) throw new Error('域名指向非公开网络地址，已停止读取。');
      const response = await requestFn(url, { method: 'GET', headers, signal: options.signal }, addresses[0]);
      if (![301,302,303,307,308].includes(response.status)) return response;
      const location = response.headers.get('location');
      try { await response.body?.cancel(); } catch {}
      if (!location || hops++ >= 5) throw new Error('平台链接重定向次数过多或地址无效。');
      target = new URL(location, url).href;
    }
  };
}

export const safeFetch = createSafeFetch();

export async function boundedText(response, maxBytes = MAX_TEXT_BYTES) {
  if (Number(response.headers.get('content-length') || 0) > maxBytes) { await response.body?.cancel(); throw new Error('平台响应超过解析大小上限。'); }
  if (!response.body) return '';
  const reader = response.body.getReader();
  let bytes = 0, text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error('平台响应超过解析大小上限。');
      text += decoder.decode(chunk.value, { stream:true });
    }
    return text + decoder.decode();
  } finally { try { await reader.cancel(); } catch {} }
}
