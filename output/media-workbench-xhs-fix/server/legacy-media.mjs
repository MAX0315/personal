// Fetch the legacy site's files from a fresh server request. Netlify's external
// rewrite can carry the new site's internal context into the old site's runtime.
// Keeping the upstream headers explicit also keeps file access bound to the
// original browser session without forwarding platform headers or credentials.
export const LEGACY_MEDIA_CHUNK_SIZE = 4 * 1024 * 1024;
const ORIGINAL = 'https://anma-media-workbench-20261014.netlify.app';
const TIMEOUT = 55000;
const ERROR_EXPIRED = '云端文件或会话已过期，请重新提取。';
const ERROR_READ = '云端视频文件读取失败，请重新提取后再保存。';
const ERROR_CHANGED = '云端文件已发生变化，请重新提取后再保存。';
const ERROR_RANGE = '媒体服务器未返回完整的分段文件，请重新提取后再保存。';

class MediaError extends Error {
  constructor(message, status = 502, total) {
    super(message);
    this.status = status;
    this.total = total;
  }
}

function errorResponse(error) {
  const known = error instanceof MediaError;
  const headers = {
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  };
  if (known && error.status === 416 && Number.isSafeInteger(error.total)) {
    headers['content-range'] = `bytes */${error.total}`;
  }
  return Response.json({ error: known ? error.message : ERROR_READ }, {
    status: known ? error.status : 502, headers,
  });
}

function requestHeaders(request) {
  const headers = new Headers();
  // Byte ranges refer to the stored representation, so request no compression
  // that Node fetch might transparently decode before length verification.
  headers.set('accept-encoding', 'identity');
  const accept = request.headers.get('accept');
  if (accept) headers.set('accept', accept);
  const cookies = (request.headers.get('cookie') || '').split(';')
    .filter(value => value.trim() && !/^anma_xhs_session\s*=/i.test(value.trim()))
    .join(';');
  if (cookies) headers.set('cookie', cookies);
  return headers;
}

function integer(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

function contentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(value || '');
  if (!match) return null;
  const [start, end, total] = match.slice(1).map(integer);
  if ([start, end, total].includes(null) || start > end || end >= total || total < 1) return null;
  return { start, end, total };
}

function mediaType(response) {
  const value = response.headers.get('content-type') || 'application/octet-stream';
  const type = value.split(';')[0].trim().toLowerCase();
  if (!/^(?:video|audio|image)\/[\w.+-]+$/.test(type) &&
      !['application/octet-stream', 'application/mp4'].includes(type)) {
    throw new MediaError('云端返回了页面或错误信息，未取得视频文件，请重新提取。');
  }
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') throw new MediaError(ERROR_RANGE);
  return value;
}

async function cancel(response) {
  try { await response.body?.cancel(); } catch {}
}

function requireSuccess(response) {
  if ([401, 403, 404, 410].includes(response.status)) {
    throw new MediaError(ERROR_EXPIRED, response.status);
  }
  if (![200, 206].includes(response.status)) throw new MediaError(ERROR_READ);
}

async function readExact(response, expected) {
  const declared = response.headers.get('content-length');
  if (declared !== null && integer(declared) !== expected) {
    await cancel(response);
    throw new MediaError(ERROR_RANGE);
  }
  if (!response.body || !Number.isSafeInteger(expected) || expected < 1 || expected > LEGACY_MEDIA_CHUNK_SIZE) {
    await cancel(response);
    throw new MediaError(ERROR_RANGE);
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(expected);
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || received + value.byteLength > expected) {
        throw new MediaError(ERROR_RANGE);
      }
      bytes.set(value, received);
      received += value.byteLength;
    }
    if (received !== expected) throw new MediaError(ERROR_RANGE);
    return bytes;
  } catch (error) {
    try { await reader.cancel(); } catch {}
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function metadata(response, total) {
  const values = new Headers();
  values.set('content-type', mediaType(response));
  for (const name of ['etag', 'last-modified', 'content-disposition']) {
    if (response.headers.has(name)) values.set(name, response.headers.get(name));
  }
  values.set('cache-control', 'private, no-store');
  values.set('x-content-type-options', 'nosniff');
  values.set('accept-ranges', 'bytes');
  return { total, headers: values };
}

async function probe(target, headers, transport, signal) {
  const head = await transport(target, { method: 'HEAD', headers: new Headers(headers), redirect: 'manual', signal });
  try {
    if (![405, 501].includes(head.status)) {
      requireSuccess(head);
      mediaType(head);
      const range = head.status === 206 ? contentRange(head.headers.get('content-range')) : null;
      if (head.status === 206 && !range) throw new MediaError(ERROR_RANGE);
      const total = range?.total ?? integer(head.headers.get('content-length'));
      if (total !== null && total > 0) return metadata(head, total);
    }
  } finally {
    await cancel(head);
  }
  const probeHeaders = new Headers(headers);
  probeHeaders.set('range', 'bytes=0-0');
  const response = await transport(target, { method: 'GET', headers: probeHeaders, redirect: 'manual', signal });
  try {
    requireSuccess(response);
    mediaType(response);
    if (response.status === 206) {
      const range = contentRange(response.headers.get('content-range'));
      if (!range || range.start !== 0 || range.end !== 0) throw new MediaError(ERROR_RANGE);
      const result = metadata(response, range.total);
      await readExact(response, 1);
      return result;
    }
    // Some file servers ignore Range. Its declared full size is still useful
    // metadata; cancel this body and only read a complete small file below.
    const total = integer(response.headers.get('content-length'));
    if (!total || total < 1) throw new MediaError('无法确认视频文件大小，请重新提取。');
    return metadata(response, total);
  } finally {
    await cancel(response);
  }
}

function selectRange(value, total) {
  const invalid = () => { throw new MediaError('文件分段范围无效，请重新提取。', 416, total); };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value?.trim() || '');
  if (!match || !match[1] && !match[2]) return invalid();
  const first = match[1] ? integer(match[1]) : null;
  const last = match[2] ? integer(match[2]) : null;
  if (match[1] && first === null || match[2] && last === null) return invalid();
  if (first === null) {
    if (last < 1) return invalid();
    // Keep the tail for suffix probes; MP4 metadata often lives at the end.
    return { start: Math.max(0, total - Math.min(last, LEGACY_MEDIA_CHUNK_SIZE)), end: total - 1 };
  }
  if (first >= total || last !== null && last < first) return invalid();
  return { start: first, end: Math.min(last ?? total - 1, total - 1, first + LEGACY_MEDIA_CHUNK_SIZE - 1) };
}

function matchesIfRange(value, headers) {
  if (!value) return true;
  const validator = value.trim();
  if (validator.startsWith('"') || validator.startsWith('W/')) {
    return !validator.startsWith('W/') && validator === headers.get('etag');
  }
  const requested = Date.parse(validator);
  const modified = Date.parse(headers.get('last-modified') || '');
  return Number.isFinite(requested) && requested === modified;
}

function looksLikePage(bytes) {
  const beginning = new TextDecoder().decode(bytes.subarray(0, 100)).replace(/^\uFEFF/, '').trimStart();
  return /^(?:[\[{]|<(?:!doctype\s+html|html|head|body|script)\b)/i.test(beginning);
}

/** Serve only original-site media, in bounded, independently checked pieces. */
export async function handleLegacyMedia(request, { transport = fetch, originalOrigin = ORIGINAL } = {}) {
  try {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith('/api/files/')) throw new MediaError('文件地址无效。', 404);
    if (!['GET', 'HEAD'].includes(request.method)) throw new MediaError('文件读取仅支持 GET 或 HEAD。', 405);
    const target = new URL(incoming.pathname + incoming.search, new URL(originalOrigin).origin).href;
    const headers = requestHeaders(request);
    const timeout = AbortSignal.timeout(TIMEOUT);
    const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any([request.signal, timeout]) : timeout;
    const info = await probe(target, headers, transport, signal);
    const incomingRange = request.headers.get('range');
    const range = incomingRange === null ? null : selectRange(incomingRange, info.total);
    const ifRange = request.headers.get('if-range');
    const mismatch = range && !matchesIfRange(ifRange, info.headers);
    const useRange = mismatch ? null : range;
    const isPartial = !!useRange || !mismatch && info.total > LEGACY_MEDIA_CHUNK_SIZE;
    const selected = useRange || { start: 0, end: Math.min(info.total, LEGACY_MEDIA_CHUNK_SIZE) - 1 };
    const outgoing = new Headers(info.headers);
    if (request.method === 'HEAD') {
      // Full HEAD metadata is safe even for large files: it sends no bytes.
      const headPartial = !!useRange;
      outgoing.set('content-length', String(headPartial ? selected.end - selected.start + 1 : info.total));
      if (headPartial) outgoing.set('content-range', `bytes ${selected.start}-${selected.end}/${info.total}`);
      return new Response(null, { status: headPartial ? 206 : 200, headers: outgoing });
    }
    if (mismatch && info.total > LEGACY_MEDIA_CHUNK_SIZE) throw new MediaError(ERROR_CHANGED, 422);
    if (isPartial) {
      headers.set('range', `bytes=${selected.start}-${selected.end}`);
      if (range && ifRange && !mismatch) headers.set('if-range', ifRange);
    }
    const response = await transport(target, { method: 'GET', headers, redirect: 'manual', signal });
    try {
      requireSuccess(response);
      const type = mediaType(response);
      const priorETag = info.headers.get('etag'), currentETag = response.headers.get('etag');
      if (priorETag && currentETag && priorETag !== currentETag) throw new MediaError(ERROR_CHANGED, 422);
      let bytes;
      if (response.status === 206) {
        const receivedRange = contentRange(response.headers.get('content-range'));
        if (!receivedRange || receivedRange.total !== info.total ||
            receivedRange.start !== selected.start || receivedRange.end !== selected.end) {
          throw new MediaError(ERROR_RANGE);
        }
        bytes = await readExact(response, selected.end - selected.start + 1);
      } else {
        if (response.headers.has('content-range') || info.total > LEGACY_MEDIA_CHUNK_SIZE) {
          throw new MediaError(ERROR_RANGE, 422);
        }
        const complete = await readExact(response, info.total);
        if (looksLikePage(complete)) throw new MediaError('云端返回了页面或错误信息，未取得视频文件，请重新提取。');
        bytes = isPartial ? complete.subarray(selected.start, selected.end + 1) : complete;
      }
      if (selected.start === 0 && looksLikePage(bytes)) {
        throw new MediaError('云端返回了页面或错误信息，未取得视频文件，请重新提取。');
      }
      if (type.split(';')[0].trim().toLowerCase() !== 'application/octet-stream') outgoing.set('content-type', type);
      for (const name of ['etag', 'last-modified', 'content-disposition']) {
        if (response.headers.has(name)) outgoing.set(name, response.headers.get(name));
      }
      outgoing.set('content-length', String(bytes.byteLength));
      if (isPartial) outgoing.set('content-range', `bytes ${selected.start}-${selected.end}/${info.total}`);
      // A ReadableStream selects Netlify's streaming response path. The body is
      // capped at 4 MiB, safely below its 20 MB streamed response limit.
      const body = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
      return new Response(body, { status: isPartial ? 206 : 200, headers: outgoing });
    } finally {
      await cancel(response);
    }
  } catch (error) {
    return errorResponse(error);
  }
}
