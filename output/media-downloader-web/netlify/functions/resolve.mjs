import { resolveInput } from '../../server/resolve.mjs';

// Use the canonical function endpoint; netlify.toml maps /api/resolve to it.
export const config = {};
const MAX_BODY = 24000;
const headers = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' };

function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers }); }

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error:'请使用 POST 解析分享链接。' }, 405);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return json({ error:'请求需要使用 JSON 格式。' }, 415);
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json({ error:'分享内容过长。' }, 413);
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error:'分享内容为空。' }, 400);
    let bytes = 0, text = ''; const decoder = new TextDecoder();
    try {
      while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > MAX_BODY) return json({ error:'分享内容过长。' }, 413); text += decoder.decode(chunk.value, { stream:true }); }
      text += decoder.decode();
    } finally { try { await reader.cancel(); } catch {} }
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'pageUrl')) return json({ error:'请求只支持 pageUrl 分享内容。' }, 400);
    const result = await resolveInput(payload);
    return json(result);
  } catch (error) {
    const message = error instanceof SyntaxError ? '请求 JSON 无效。' : error?.message || '链接解析失败，请重试。';
    return json({ error:message, needsBridge:false }, 400);
  }
}
