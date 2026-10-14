import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLegacyMedia, LEGACY_MEDIA_CHUNK_SIZE as CHUNK } from '../server/legacy-media.mjs';

const ORIGINAL = 'https://anma-media-workbench-20261014.netlify.app';
const MODIFIED = 'Wed, 14 Oct 2026 01:02:03 GMT';
const LOCAL_COOKIE = 'anma_xhs_session=' + 'a'.repeat(64);
const path = '/api/files/32f2a23e/video.mp4?download=1';
function request({ method = 'GET', headers = {}, url = 'https://new.example' + path } = {}) {
  return new Request(url, { method, headers });
}
function bytes(start, size) { return Uint8Array.from({ length: size }, (_, index) => (start + index) % 251); }
function fixture({ total = 12, head, get } = {}) {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, ...options, headers: new Headers(options.headers) });
    if (options.method === 'HEAD') {
      return head ? head(options) : new Response(null, { headers: {
        'content-type': 'video/mp4', 'content-length': String(total), etag: '"stable"',
        'last-modified': MODIFIED, 'content-disposition': 'attachment; filename="video.mp4"',
      } });
    }
    if (get) return get(options, calls.length);
    const range = /^bytes=(\d+)-(\d+)$/.exec(options.headers.get('range') || '');
    const start = range ? Number(range[1]) : 0, end = range ? Number(range[2]) : total - 1;
    const headers = { 'content-type': 'video/mp4', 'content-length': String(end - start + 1), etag: '"stable"' };
    if (range) headers['content-range'] = `bytes ${start}-${end}/${total}`;
    return new Response(bytes(start, end - start + 1), { status: range ? 206 : 200, headers });
  };
  return { calls, transport, handle: req => handleLegacyMedia(req, { transport }) };
}

test('legacy media uses a fresh fixed-origin request and only forwards the original session', async () => {
  const f = fixture();
  const response = await f.handle(request({ headers: {
    cookie: `legacy_session=original; ${LOCAL_COOKIE}; theme=light`, accept: 'video/*',
    range: 'bytes=0-11', 'if-range': '"stable"', 'x-nf-site-id': 'new-site',
    'x-nf-deploy-id': 'new-deploy', 'x-nf-blobs-context': 'new-context',
    authorization: 'do-not-forward', origin: 'https://new.example', 'accept-encoding': 'gzip, br',
  } }));
  assert.equal(response.status, 206);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes(0, 12));
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.equal(call.url, ORIGINAL + path);
    assert.equal(call.redirect, 'manual');
    assert.ok(call.signal instanceof AbortSignal);
    assert.equal(call.headers.get('cookie'), 'legacy_session=original; theme=light');
    assert.equal(call.headers.get('accept'), 'video/*');
    assert.equal(call.headers.get('accept-encoding'), 'identity');
    for (const name of ['x-nf-site-id', 'x-nf-deploy-id', 'x-nf-blobs-context', 'authorization', 'origin', 'host']) {
      assert.equal(call.headers.has(name), false, name);
    }
  }
  assert.equal(f.calls[0].method, 'HEAD');
  assert.equal(f.calls[0].headers.has('range'), false);
  assert.equal(f.calls[0].headers.has('if-range'), false);
  assert.equal(f.calls[1].headers.get('range'), 'bytes=0-11');
  assert.equal(f.calls[1].headers.get('if-range'), '"stable"');
});

test('complete small files preserve media headers and are privately cached', async () => {
  const f = fixture(), response = await f.handle(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(response.headers.get('content-length'), '12');
  assert.equal(response.headers.get('content-range'), null);
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('etag'), '"stable"');
  assert.equal(response.headers.get('last-modified'), MODIFIED);
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="video.mp4"');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes(0, 12));
});

test('the screenshot legacy file route returns its exact complete 206 piece', async () => {
  const total = 1_300_000, f = fixture({ total });
  const response = await f.handle(request({ headers: { range: `bytes=0-${total - 1}` } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes 0-${total - 1}/${total}`);
  assert.equal(response.headers.get('content-length'), String(total));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes(0, total));
});

test('closed, open, suffix and clipped ranges keep the actual offsets', async () => {
  for (const [value, start, end] of [['bytes=2-5', 2, 5], ['bytes=7-', 7, 11], ['bytes=-3', 9, 11], ['bytes=9-90', 9, 11], ['bytes=-90', 0, 11], ['bytes=0-0', 0, 0]]) {
    const f = fixture(), response = await f.handle(request({ headers: { range: value } }));
    assert.equal(response.status, 206, value);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/12`, value);
    assert.equal(response.headers.get('content-length'), String(end - start + 1), value);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes(start, end - start + 1), value);
  }
});

test('invalid, multiple and unsatisfiable ranges return 416 without reading media', async () => {
  for (const range of ['bytes=12-', 'bytes=9-8', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'items=1-2', 'bytes=9007199254740993-', 'bytes=a-b']) {
    const f = fixture(), response = await f.handle(request({ headers: { range } }));
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('content-range'), 'bytes */12', range);
    assert.match((await response.json()).error, /范围无效/);
    assert.equal(f.calls.length, 1, range);
  }
});

test('HEAD sends metadata only and never exposes or reads the upstream body', async () => {
  let canceled = false;
  const f = fixture({ head: () => new Response(new ReadableStream({ cancel() { canceled = true; } }), {
    headers: { 'content-type': 'video/mp4', 'content-length': '12', etag: '"stable"' },
  }) });
  const response = await f.handle(request({ method: 'HEAD' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '12');
  assert.equal((await response.arrayBuffer()).byteLength, 0);
  assert.equal(canceled, true);
  assert.equal(f.calls.length, 1);
  const ranged = await fixture().handle(request({ method: 'HEAD', headers: { range: 'bytes=2-5' } }));
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 2-5/12');
  assert.equal(ranged.headers.get('content-length'), '4');
  assert.equal((await ranged.arrayBuffer()).byteLength, 0);
});

test('large full HEAD reports the complete size without applying the GET chunk cap', async () => {
  const total = CHUNK * 6, f = fixture({ total });
  const response = await f.handle(request({ method: 'HEAD' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), String(total));
  assert.equal(response.headers.get('content-range'), null);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
  assert.equal(f.calls.length, 1);
});

test('a malformed 206 HEAD cannot be mistaken for a complete file size', async () => {
  const f = fixture({ head: () => new Response(null, { status: 206, headers: {
    'content-type': 'video/mp4', 'content-length': '1', 'content-range': 'invalid',
  } }) });
  const response = await f.handle(request());
  assert.equal(response.status, 502);
  assert.equal(f.calls.length, 1);
});

test('missing HEAD size falls back to an exact one-byte probe', async () => {
  const f = fixture({ head: () => new Response(null, { headers: { 'content-type': 'video/mp4' } }) });
  const response = await f.handle(request({ headers: { range: 'bytes=2-5' } }));
  assert.equal(response.status, 206);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[1].headers.get('range'), 'bytes=0-0');
  assert.equal(f.calls[2].headers.get('range'), 'bytes=2-5');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes(2, 4));
});

test('unsupported HEAD falls back to a range probe', async () => {
  for (const status of [405, 501]) {
    const f = fixture({ head: () => new Response(null, { status }) });
    assert.equal((await f.handle(request())).status, 200);
    assert.equal(f.calls[1].headers.get('range'), 'bytes=0-0');
  }
});

test('a small complete upstream 200 can safely satisfy Range by local slicing', async () => {
  const f = fixture({ get: () => new Response(bytes(0, 12), { headers: { 'content-type': 'video/mp4', 'content-length': '12' } }) });
  const response = await f.handle(request({ headers: { range: 'bytes=2-5' } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/12');
  assert.equal(response.headers.get('content-length'), '4');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes(2, 4));
});

test('large full, open and closed responses are capped below Netlify streaming limits', async () => {
  const total = CHUNK * 6 + 100;
  for (const range of [undefined, 'bytes=0-', `bytes=0-${total - 1}`]) {
    const f = fixture({ total }), response = await f.handle(request({ headers: range ? { range } : {} }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes 0-${CHUNK - 1}/${total}`);
    assert.equal(response.headers.get('content-length'), String(CHUNK));
    assert.equal(f.calls[1].headers.get('range'), `bytes=0-${CHUNK - 1}`);
    assert.equal((await response.arrayBuffer()).byteLength, CHUNK);
  }
  const lastStart = total - 100, f = fixture({ total });
  const tail = await f.handle(request({ headers: { range: `bytes=${lastStart}-` } }));
  assert.equal(tail.headers.get('content-range'), `bytes ${lastStart}-${total - 1}/${total}`);
  assert.equal((await tail.arrayBuffer()).byteLength, 100);
});

test('large suffix probes keep the actual file tail and cap the response', async () => {
  const total = CHUNK * 6, f = fixture({ total });
  const response = await f.handle(request({ headers: { range: `bytes=-${CHUNK * 2}` } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes ${total - CHUNK}-${total - 1}/${total}`);
  assert.equal((await response.arrayBuffer()).byteLength, CHUNK);
});

test('a large upstream that ignores Range is canceled without buffering its body', async () => {
  let canceled = false;
  const f = fixture({ total: CHUNK * 6, get: () => new Response(new ReadableStream({ cancel() { canceled = true; } }), {
    headers: { 'content-type': 'video/mp4', 'content-length': String(CHUNK * 6) },
  }) });
  const response = await f.handle(request({ headers: { range: 'bytes=0-9' } }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /分段文件/);
  assert.equal(canceled, true);
});

test('matching strong If-Range and HTTP date validators are forwarded', async () => {
  for (const ifRange of ['"stable"', MODIFIED]) {
    const f = fixture(), response = await f.handle(request({ headers: { range: 'bytes=2-5', 'if-range': ifRange } }));
    assert.equal(response.status, 206);
    assert.equal(f.calls[1].headers.get('if-range'), ifRange);
  }
});

test('mismatched or weak If-Range validators give the complete small file as 200', async () => {
  for (const ifRange of ['"old"', 'W/"stable"', 'invalid-date', 'Tue, 13 Oct 2026 01:02:03 GMT']) {
    const f = fixture(), response = await f.handle(request({ headers: { range: 'bytes=2-5', 'if-range': ifRange } }));
    assert.equal(response.status, 200, ifRange);
    assert.equal(response.headers.get('content-range'), null);
    assert.equal(response.headers.get('content-length'), '12');
    assert.equal(f.calls[1].headers.has('range'), false);
    assert.equal(f.calls[1].headers.has('if-range'), false);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes(0, 12));
  }
});

test('mismatched large If-Range does not fabricate a partial success', async () => {
  const f = fixture({ total: CHUNK * 6 });
  const response = await f.handle(request({ headers: { range: 'bytes=0-9', 'if-range': '"old"' } }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /已发生变化/);
  assert.equal(f.calls.length, 1);
  const head = await f.handle(request({ method: 'HEAD', headers: { range: 'bytes=0-9', 'if-range': '"old"' } }));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(CHUNK * 6));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('a legacy upstream 500 becomes a clear JSON error with no sensitive details', async () => {
  for (const failHead of [false, true]) {
    const fail = () => new Response('<html>Internal server error: private-cookie secret-context</html>', { status: 500, headers: { 'content-type': 'text/html' } });
    const f = fixture({ head: failHead ? fail : undefined, get: failHead ? undefined : fail });
    const response = await f.handle(request({ headers: { cookie: 'private-cookie', range: 'bytes=0-11' } }));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(response.headers.get('content-range'), null);
    const result = await response.text();
    assert.match(result, /文件读取失败/);
    for (const sensitive of ['private-cookie', 'secret-context', ORIGINAL, path]) assert.equal(result.includes(sensitive), false);
  }
});

test('session expiry is reported accurately rather than as an encoding error', async () => {
  for (const status of [401, 403, 404, 410]) {
    const f = fixture({ get: () => Response.json({ error: 'internal details' }, { status }) });
    const response = await f.handle(request());
    assert.equal(response.status, status);
    assert.match((await response.json()).error, /会话已过期/);
  }
});

test('HTML, JSON and mislabeled page bodies never become playable video responses', async () => {
  for (const [contentType, body] of [['text/html', '<html>error</html>'], ['application/json', '{"error":1}'], ['video/mp4', '<html>error</html>'], ['application/octet-stream', '{"error":1}']]) {
    const encoded = new TextEncoder().encode(body);
    const f = fixture({ total: encoded.byteLength, get: () => new Response(encoded, { headers: { 'content-type': contentType, 'content-length': String(encoded.byteLength) } }) });
    const response = await f.handle(request());
    assert.equal(response.status, 502, contentType);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.match((await response.json()).error, /页面或错误信息/);
  }
});

test('truncated, oversized and misdeclared bodies cannot claim successful ranges', async () => {
  for (const [length, declared] of [[3, '4'], [5, '4'], [4, '3'], [4, null]]) {
    const f = fixture({ get: () => new Response(bytes(2, length), { status: 206, headers: {
      'content-type': 'video/mp4', 'content-range': 'bytes 2-5/12', ...(declared === null ? {} : { 'content-length': declared }),
    } }) });
    const response = await f.handle(request({ headers: { range: 'bytes=2-5' } }));
    assert.equal(response.status, declared === null ? 206 : 502);
    if (declared === null) assert.equal((await response.arrayBuffer()).byteLength, 4);
    else assert.match((await response.json()).error, /分段文件/);
  }
});

test('incorrect Content-Range offsets, totals and formats are refused', async () => {
  for (const value of ['bytes 1-4/12', 'bytes 2-5/13', 'bytes 2-4/12', 'bytes 2-5/*', 'invalid', 'bytes 2-5/5']) {
    const f = fixture({ get: () => new Response(bytes(2, 4), { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': value, 'content-length': '4' } }) });
    const response = await f.handle(request({ headers: { range: 'bytes=2-5' } }));
    assert.equal(response.status, 502, value);
    assert.equal(response.headers.get('content-range'), null);
  }
});

test('a changed file validator between metadata and bytes requires a fresh extraction', async () => {
  const f = fixture({ get: () => new Response(bytes(2, 4), { status: 206, headers: {
    'content-type': 'video/mp4', 'content-range': 'bytes 2-5/12', 'content-length': '4', etag: '"changed"',
  } }) });
  const response = await f.handle(request({ headers: { range: 'bytes=2-5', 'if-range': '"stable"' } }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /已发生变化/);
});

test('network failures, redirects and compressed bytes return safe errors', async () => {
  for (const get of [
    () => { throw new Error('secret-cookie upstream-token https://private.example'); },
    () => new Response(null, { status: 302, headers: { location: 'https://private.example' } }),
    () => new Response(bytes(0, 12), { headers: { 'content-type': 'video/mp4', 'content-length': '12', 'content-encoding': 'gzip' } }),
  ]) {
    const f = fixture({ get }), response = await f.handle(request());
    assert.equal(response.status, 502);
    const error = await response.text();
    assert.equal(/secret-cookie|upstream-token|private\.example/.test(error), false);
    assert.equal(response.headers.get('location'), null);
  }
});

test('invalid routes and write methods are refused before contacting the original site', async () => {
  const f = fixture();
  assert.equal((await f.handle(request({ url: 'https://new.example/api/status' }))).status, 404);
  assert.equal((await f.handle(request({ method: 'POST' }))).status, 405);
  assert.equal(f.calls.length, 0);
});
