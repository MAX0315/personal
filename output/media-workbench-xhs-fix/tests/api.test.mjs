import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../netlify/functions/api.mjs';

const ORIGIN = 'https://fixed.example';
const ORIGINAL = 'https://anma-media-workbench-20261014.netlify.app';
const SHARE = '租房视频 https://xhslink.cn/o/70a9Csr9Fob 复制进入小红书';
const CONTENT = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
function fixture() {
  const entries = new Map(), deleted = [], calls = [], resolved = [];
  const store = {
    async get(key, { type } = {}) {
      const value = entries.get(key);
      if (value == null) return null;
      return type === 'arrayBuffer' ? value.slice().buffer : structuredClone(value);
    },
    async set(key, value) { entries.set(key, new Uint8Array(value)); },
    async setJSON(key, value) { entries.set(key, structuredClone(value)); },
    async delete(key) { deleted.push(key); entries.delete(key); },
  };
  const transport = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/status')) return Response.json({ ready: true, version: '2.5.0-web', lastJobId: 'old-job' });
    return Response.json({ jobId: 'original-job', source: 'original' }, { status: 202, headers: { 'set-cookie': 'legacy_session=abc; Domain=anma-media-workbench-20261014.netlify.app; Path=/; HttpOnly' } });
  };
  const resolver = async (input, options) => {
    resolved.push({ input, options });
    return { bytes: CONTENT, candidate: { kind: 'video', fileName: '租房.mp4', videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, format: 'mp4', width: 720, height: 1280, duration: 2.5 },
      title: '租房', contentText: '真实笔记正文', videoId: '675abcdef0123456789abcde', platform: 'xiaohongshu', verifiedFile: true, verification: 'container-and-length' };
  };
  return { entries, deleted, calls, resolved, store, transport, resolver, handler: createApi({ storeFactory: () => store, transport, resolver }) };
}
function request(path, { method = 'GET', cookie, range, body, headers = {} } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('cookie', cookie);
  if (range) h.set('range', range);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function created() {
  const f = fixture();
  const response = await f.handler(request('/api/jobs', { method: 'POST', body: { input: SHARE } }));
  assert.equal(response.status, 202);
  const id = (await response.json()).jobId, cookie = response.headers.get('set-cookie').split(';')[0];
  return { ...f, id, cookie, file: `/api/files/xhs/${id}/video.mp4` };
}

test('creates an owner-bound XHS job with same-origin media and private cookie', async () => {
  const f = await created();
  assert.match(f.id, /^xhs-[a-f\d]{32}$/);
  assert.match(f.cookie, /^anma_xhs_session=[a-f\d]{64}$/);
  assert.equal(f.resolved[0].input, SHARE);
  assert.equal(f.resolved[0].options.transport, f.transport);
  assert.ok(f.resolved[0].options.signal instanceof AbortSignal);
  assert.equal(f.calls.length, 0);
  const response = await f.handler(request(`/api/jobs/${f.id}`, { cookie: f.cookie }));
  const job = await response.json();
  assert.equal(job.state, 'done');
  assert.equal(job.received, CONTENT.length);
  assert.equal(job.result.candidates[0].videoUrl, f.file);
  assert.equal(job.result.candidates[0].downloadUrl, f.file + '?download=1');
  assert.equal(job.result.candidates[0].codec, 'H264');
  assert.equal(job.result.verification, 'container-and-length');
  for (const privateField of ['owner', 'expiresAt', 'sha256']) assert.equal(Object.hasOwn(job, privateField), false);
  const owner = f.cookie.split('=')[1];
  assert.equal(f.entries.get(`sessions/${owner}`).id, f.id);
  assert.match(f.entries.get(`jobs/${f.id}`).sha256, /^[a-f\d]{64}$/);
});

test('job and media reads require the matching owner cookie', async () => {
  const f = await created();
  for (const cookie of [undefined, 'anma_xhs_session=' + 'f'.repeat(64), f.cookie + 'BAD']) {
    for (const path of [`/api/jobs/${f.id}`, f.file]) {
      const response = await f.handler(request(path, { cookie }));
      assert.equal(response.status, 404);
      assert.match((await response.json()).error, /会话已过期/);
    }
  }
  const allowed = await f.handler(request(f.file, { cookie: `legacy=abc; ${f.cookie}; theme=dark` }));
  assert.equal(allowed.status, 200);
  assert.deepEqual(new Uint8Array(await allowed.arrayBuffer()), CONTENT);
});

test('media provides full GET, HEAD metadata and encoded download filename', async () => {
  const f = await created();
  const response = await f.handler(request(f.file + '?download=1', { cookie: f.cookie }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(response.headers.get('content-length'), String(CONTENT.length));
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('etag'), /^"[a-f\d]{64}"$/);
  assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8''%E7%A7%9F%E6%88%BF.mp4/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), CONTENT);
  const head = await f.handler(request(f.file, { method: 'HEAD', cookie: f.cookie }));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('serves exact closed, open and suffix byte ranges with 206', async () => {
  const f = await created();
  for (const [range, start, end] of [['bytes=2-5', 2, 5], ['bytes=7-', 7, 9], ['bytes=-3', 7, 9], ['bytes=8-100', 8, 9], ['bytes=-100', 0, 9], ['bytes=0-0', 0, 0]]) {
    const response = await f.handler(request(f.file, { cookie: f.cookie, range }));
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/10`);
    assert.equal(response.headers.get('content-length'), String(end - start + 1));
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), CONTENT.slice(start, end + 1));
  }
  const head = await f.handler(request(f.file, { method: 'HEAD', cookie: f.cookie, range: 'bytes=2-5' }));
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('content-length'), '4');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('rejects invalid or unsatisfiable ranges with accurate 416 size', async () => {
  const f = await created();
  for (const range of ['bytes=10-', 'bytes=9-8', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'items=1-2', 'bytes=9007199254740993-', 'bytes=a-b']) {
    const response = await f.handler(request(f.file, { cookie: f.cookie, range }));
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('content-range'), 'bytes */10');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});

test('expired jobs refuse access and remove both job and media', async () => {
  for (const useFile of [false, true]) {
    const f = await created(), record = f.entries.get(`jobs/${f.id}`);
    record.expiresAt = Date.now() - 1000;
    const response = await f.handler(request(useFile ? f.file : `/api/jobs/${f.id}`, { cookie: f.cookie }));
    assert.equal(response.status, 404);
    assert.deepEqual(f.deleted.sort(), [`files/${f.id}`, `jobs/${f.id}`].sort());
    assert.equal(f.entries.has(`files/${f.id}`), false);
    assert.equal(f.entries.has(`jobs/${f.id}`), false);
  }
});

test('non-XHS requests preserve the original body and strip only the local owner cookie', async () => {
  const f = await created(), owner = f.cookie.split('=')[1];
  const payload = { input: 'https://www.douyin.com/video/12345', mode: 'video', title: '测试' };
  const response = await f.handler(request('/api/jobs?source=test', { method: 'POST', cookie: `legacy_session=abc; ${f.cookie}; theme=light`, body: payload, headers: { origin: ORIGIN } }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { jobId: 'original-job', source: 'original' });
  const call = f.calls.at(-1);
  assert.equal(call.url, ORIGINAL + '/api/jobs?source=test');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.redirect, 'manual');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(call.options.body)), payload);
  assert.equal(call.options.headers.get('cookie').includes('anma_xhs_session'), false);
  assert.match(call.options.headers.get('cookie'), /legacy_session=abc/);
  assert.match(call.options.headers.get('cookie'), /theme=light/);
  assert.equal(call.options.headers.get('origin'), ORIGINAL);
  assert.equal(response.headers.get('set-cookie').includes('Domain='), false);
  assert.equal(f.entries.has(`sessions/${owner}`), false);
});

test('public-share failure falls back to original extraction without sending the local cookie', async () => {
  const f = fixture();
  const handler = createApi({ storeFactory: () => f.store, transport: f.transport, resolver: async () => { throw new Error('需要官方登录'); } });
  const response = await handler(request('/api/jobs', { method: 'POST', cookie: 'anma_xhs_session=' + 'a'.repeat(64), body: { input: SHARE } }));
  assert.equal(response.status, 202);
  assert.equal((await response.json()).jobId, 'original-job');
  assert.equal(f.calls[0].options.headers.has('cookie'), false);
  assert.equal(f.entries.size, 0);
});

test('status reports the fixed version and the current owner last XHS job', async () => {
  const f = await created();
  const response = await f.handler(request('/api/status', { cookie: f.cookie }));
  const status = await response.json();
  assert.equal(status.ready, true);
  assert.equal(status.version, '2.5.3-web');
  assert.equal(status.xhsMobileShare, true);
  assert.equal(status.lastJobId, f.id);
  assert.equal(f.calls.at(-1).options.headers.has('cookie'), false);
});

test('rejects non-JSON, malformed JSON and oversized job requests before resolving', async () => {
  const f = fixture();
  const plain = new Request(ORIGIN + '/api/jobs', { method: 'POST', body: SHARE, headers: { 'content-type': 'text/plain' } });
  assert.equal((await f.handler(plain)).status, 415);
  const invalid = new Request(ORIGIN + '/api/jobs', { method: 'POST', body: '{broken', headers: { 'content-type': 'application/json' } });
  assert.equal((await f.handler(invalid)).status, 400);
  assert.equal((await f.handler(request('/api/jobs', { method: 'POST', body: { input: 'a'.repeat(25000) } }))).status, 413);
  assert.equal(f.resolved.length, 0);
  assert.equal(f.calls.length, 0);
});

test('Douyin share captions become the exact canonical job input and retain the legacy login cookies',async()=>{
 const f=fixture(),calls=[];
 const transport=async(url,options)=>{
  calls.push({url,options});
  if(url==='https://v.douyin.com/LHRdu-1AjXs/')return new Response(null,{status:302,headers:{location:'https://www.iesdouyin.com/share/video/7693770573902984049/'}});
  return f.transport(url,options);
 };
 const handler=createApi({storeFactory:()=>f.store,transport,resolver:f.resolver});
 const response=await handler(request('/api/jobs',{method:'POST',cookie:'legacy_session=abc; anma_xhs_session='+'a'.repeat(64),body:{input:'你好 https://v.douyin.com/LHRdu-1AjXs/ 复制打开抖音',mode:'video'}}));
 assert.equal(response.status,202);
 assert.equal((await response.json()).jobId,'original-job');
 assert.equal(calls.length,2);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(calls[1].options.body)),{input:'https://www.douyin.com/video/7693770573902984049',mode:'video'});
 assert.match(calls[1].options.headers.get('cookie'),/legacy_session=abc/);
 assert.equal(calls[1].options.headers.get('cookie').includes('anma_xhs_session'),false);
});
test('unresolved Douyin short links fail clearly without starting the known failing browser path',async()=>{
 const f=fixture();
 const handler=createApi({storeFactory:()=>f.store,transport:async()=>new Response('unresolved'),resolver:f.resolver});
 const response=await handler(request('/api/jobs',{method:'POST',body:{input:'https://v.douyin.com/LHRdu-1AjXs/'}}));
 assert.equal(response.status,422);assert.match((await response.json()).error,/暂未返回作品地址/);
 assert.equal(f.calls.length,0);
});
