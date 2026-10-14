import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLegacyJob } from '../server/legacy-verify.mjs';
import { LEGACY_MEDIA_CHUNK_SIZE as CHUNK } from '../server/legacy-media.mjs';

const ORIGIN = 'https://fixed.example';
const ORIGINAL = 'https://anma-media-workbench-20261014.netlify.app';
const FILE = '/api/files/32f2a23e/video.mp4';

// A complete MP4 container with video/audio track metadata. Frame decoding is
// a separate production QA check; these fixtures exercise container verification.
const box = (type, ...parts) => {
  const payload = Buffer.concat(parts), header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4, 4, 'latin1');
  return Buffer.concat([header, payload]);
};
const timing = (seconds = 2.5) => {
  const payload = Buffer.alloc(24);
  payload.writeUInt32BE(1000, 12);
  payload.writeUInt32BE(seconds * 1000, 16);
  return payload;
};
const track = ({ kind = 'vide', codec = 'avc1', seconds = 2.5, width = 1920, height = 1080 } = {}) => {
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  const handler = Buffer.alloc(24);
  handler.write(kind, 8);
  const description = Buffer.alloc(8);
  description.writeUInt32BE(1, 4);
  return box('trak', box('tkhd', tkhd), box('mdia', box('mdhd', timing(seconds)),
    box('hdlr', handler), box('minf', box('stbl', box('stsd', description,
      box(codec, Buffer.alloc(kind === 'vide' ? 78 : 28)))))));
};
const movie = ({ seconds = 2.5, dataBytes = 4, audio = true, codec = 'avc1', width = 1920, height = 1080 } = {}) => Buffer.concat([
  box('ftyp', Buffer.from('isom\0\0\0\0isommp42', 'latin1')),
  box('moov', box('mvhd', timing(seconds)), track({ seconds, codec, width, height }),
    ...(audio ? [track({ kind: 'soun', codec: 'mp4a', seconds })] : [])),
  box('mdat', Buffer.alloc(dataBytes, 1)),
]);

function request(owner = 'original-session-A') {
  return new Request(ORIGIN + '/api/jobs/32f2a23e', { headers: { cookie: `legacy_session=${owner}` } });
}
function job(sample, candidate = {}) {
  return { id: '32f2a23e', state: 'done', platform: 'channels', inputUrl: 'https://weixin.qq.com/sph/AfsSCKZRGm',
    received: sample.length, total: sample.length,
    result: { title: '龙叔视频', platform: 'channels', verifiedFile: false, verificationError: '旧错误', candidates: [
      { kind: 'video', bytes: sample.length, videoUrl: FILE, downloadUrl: FILE + '?download=1', fileName: 'video.mp4',
        duration: 2.4, width: 0, height: 0, codec: 'unknown', ...candidate },
    ] } };
}
function fixture({ sample = movie(), head, get, store } = {}) {
  const calls = [], entries = new Map();
  const storage = store || {
    async get(key, { type } = {}) { assert.equal(type, 'json'); return entries.has(key) ? structuredClone(entries.get(key)) : null; },
    async setJSON(key, value) { entries.set(key, structuredClone(value)); },
  };
  const transport = async (url, options) => {
    calls.push({ url, ...options, headers: new Headers(options.headers) });
    if (options.method === 'HEAD') return head ? head(options) : new Response(null, { headers: {
      'content-type': 'video/mp4', 'content-length': String(sample.length), etag: '"stable"',
    } });
    if (get) return get(options);
    const range = /^bytes=(\d+)-(\d+)$/.exec(options.headers.get('range') || '');
    assert.ok(range, 'verification must always request an exact byte range');
    const start = Number(range[1]), end = Number(range[2]);
    return new Response(sample.subarray(start, end + 1), { status: 206, headers: {
      'content-type': 'video/mp4', 'content-range': `bytes ${start}-${end}/${sample.length}`,
      'content-length': String(end - start + 1), etag: '"stable"',
    } });
  };
  return { calls, entries, sample, store: storage, transport,
    verify: (value = job(sample), req = request()) => verifyLegacyJob(value, req, { transport, storeFactory: () => storage }),
  };
}

test('complete channel MP4 bytes change false verification to true with exact media metadata', async () => {
  const f = fixture(), original = job(f.sample), before = structuredClone(original);
  const result = await f.verify(original);
  assert.equal(result.result.verifiedFile, true);
  assert.equal(result.result.verification, 'full-bytes-and-mp4');
  assert.equal(Object.hasOwn(result.result, 'verificationError'), false);
  const candidate = result.result.candidates[0];
  assert.equal(candidate.bytes, f.sample.length);
  assert.equal(candidate.duration, 2.5);
  assert.equal(candidate.width, 1920);
  assert.equal(candidate.height, 1080);
  assert.equal(candidate.format, 'mp4');
  assert.equal(candidate.codec, 'H264');
  assert.equal(candidate.hasAudio, true);
  assert.equal(candidate.videoUrl, FILE);
  assert.equal(candidate.fileName, 'video.mp4');
  assert.deepEqual(original, before, 'verification must not mutate the upstream record');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].method, 'HEAD');
  assert.equal(f.calls[1].headers.get('range'), `bytes=0-${f.sample.length - 1}`);
  assert.equal(f.calls[1].url, ORIGINAL + FILE);
});

test('full verification assembles every bounded piece of a file larger than one chunk', async () => {
  const sample = movie({ dataBytes: CHUNK + 16 }), f = fixture({ sample });
  const result = await f.verify();
  assert.equal(result.result.verifiedFile, true);
  assert.equal(result.result.candidates[0].bytes, sample.length);
  const reads = f.calls.filter(call => call.method === 'GET');
  assert.deepEqual(reads.map(call => call.headers.get('range')), [
    `bytes=0-${CHUNK - 1}`, `bytes=${CHUNK}-${sample.length - 1}`,
  ]);
  assert.equal(result.result.candidates[0].duration, 2.5);
});

test('H265 and silent video metadata are derived from the received MP4 tracks', async () => {
  const f = fixture({ sample: movie({ codec: 'hvc1', audio: false }) });
  const result = await f.verify();
  assert.equal(result.result.verifiedFile, true);
  assert.equal(result.result.candidates[0].codec, 'H265');
  assert.equal(result.result.candidates[0].hasAudio, false);
});

test('successful verification is cached only for the matching session and candidates', async () => {
  const f = fixture();
  const first = await f.verify();
  assert.equal(first.result.verifiedFile, true);
  assert.equal(f.calls.length, 2);
  const cached = await f.verify();
  assert.deepEqual(cached, first);
  assert.equal(f.calls.length, 2);
  assert.equal(f.entries.size, 1);
  const record = [...f.entries.values()][0];
  assert.ok(record.expiresAt > Date.now() + 170_000);
  assert.ok(record.expiresAt <= Date.now() + 180_000);
  await f.verify(job(f.sample), request('original-session-B'));
  assert.equal(f.calls.length, 4, 'a different session must fetch its own media');
  assert.equal(f.entries.size, 2);
  for (const key of f.entries.keys()) {
    assert.match(key, /^legacy-verification\/[a-f\d]{64}$/);
    assert.equal(key.includes('original-session'), false);
  }
  await f.verify(job(f.sample, { fileName: 'different.mp4' }));
  assert.equal(f.calls.length, 6, 'a changed candidate set must miss the previous cache');
});

test('expired verification is fetched and validated again', async () => {
  const f = fixture();
  await f.verify();
  for (const record of f.entries.values()) record.expiresAt = Date.now() - 1;
  assert.equal((await f.verify()).result.verifiedFile, true);
  assert.equal(f.calls.length, 4);
});

test('cache read/write outages do not falsely reject a fully readable channel file', async () => {
  const f = fixture({ store: { async get() { throw new Error('storage read unavailable'); }, async setJSON() { throw new Error('storage write unavailable'); } } });
  assert.equal((await f.verify()).result.verifiedFile, true);
  assert.equal(f.calls.length, 2);
});

test('storage initialization failure still allows independent media verification', async () => {
  const f = fixture();
  const result = await verifyLegacyJob(job(f.sample), request(), {
    transport: f.transport, storeFactory: () => { throw new Error('store context unavailable'); },
  });
  assert.equal(result.result.verifiedFile, true);
  assert.equal(result.result.verification, 'full-bytes-and-mp4');
  assert.equal(f.calls.length, 2);
});

test('a short failure cache does not leak verification success to another session', async () => {
  const f = fixture({ get: () => new Response('internal-error', { status: 500 }) });
  const value = job(f.sample);
  value.result.verifiedFile = true;
  const first = await f.verify(value);
  assert.equal(first.result.verifiedFile, false);
  const record = [...f.entries.values()][0];
  assert.ok(record.expiresAt > Date.now());
  assert.ok(record.expiresAt <= Date.now() + 15_000);
  assert.equal((await f.verify(value)).result.verifiedFile, false);
  assert.equal(f.calls.length, 2);
  await f.verify(value, request('original-session-B'));
  assert.equal(f.calls.length, 4);
});

test('upstream HTML, JSON and 500 responses never keep the upstream verified claim', async () => {
  for (const [status, type, body] of [[200, 'text/html', '<html>blocked</html>'], [200, 'application/json', '{"error":1}'], [500, 'text/html', '<html>secret context</html>']]) {
    const f = fixture({ get: () => new Response(body, { status, headers: { 'content-type': type } }) });
    const upstream = job(f.sample);
    upstream.result.verifiedFile = true;
    const result = await f.verify(upstream);
    assert.equal(result.state, 'done');
    assert.equal(result.result.verifiedFile, false, type);
    assert.equal(result.result.verification, 'pending-media-read');
    assert.match(result.result.verificationError, /完整读取/);
    assert.equal(/secret context|<html>|https:\/\//.test(result.result.verificationError), false);
  }
});

test('truncated HTTP bodies and incomplete MP4 containers cannot be verified', async () => {
  const source = movie(), short = source.subarray(0, source.length - 1);
  const f = fixture({ sample: source, get: options => {
    const range = options.headers.get('range').replace('=', ' ');
    return new Response(short, { status: 206, headers: { 'content-type': 'video/mp4',
      'content-range': `${range}/${source.length}`, 'content-length': String(source.length) } });
  } });
  assert.equal((await f.verify()).result.verifiedFile, false);
  const malformed = fixture({ sample: short });
  const result = await malformed.verify();
  assert.equal(result.result.verifiedFile, false);
  assert.match(result.result.verificationError, /截断|不完整/);
});

test('mismatched declared size or duration cannot claim completed verification', async () => {
  const f = fixture();
  const wrongSize = await f.verify(job(f.sample, { bytes: f.sample.length + 1 }));
  assert.equal(wrongSize.result.verifiedFile, false);
  assert.match(wrongSize.result.verificationError, /完整读取/);
  const wrongDuration = await f.verify(job(f.sample, { duration: 60 }));
  assert.equal(wrongDuration.result.verifiedFile, false);
  assert.match(wrongDuration.result.verificationError, /时长.*不一致/);
  assert.equal(wrongDuration.result.candidates[0].duration, 60);
});

test('files above 32 MiB and invalid sizes never trigger any media request', async () => {
  for (const size of [32 * 1024 * 1024 + 1, 0, -1, 1.5, NaN, 'invalid', undefined]) {
    const f = fixture();
    const result = await f.verify(job(f.sample, { bytes: size }));
    assert.equal(result.result.verifiedFile, false, String(size));
    assert.match(result.result.verificationError, /完整核验/);
    assert.equal(f.calls.length, 0, String(size));
  }
});

test('a combined candidate budget above 32 MiB is rejected before fetching the first file', async () => {
  const f = fixture(), upstream = job(f.sample, { bytes: 20 * 1024 * 1024 });
  upstream.result.candidates.push({ ...upstream.result.candidates[0], videoUrl: FILE + '?second=1' });
  const result = await f.verify(upstream);
  assert.equal(result.result.verifiedFile, false);
  assert.match(result.result.verificationError, /完整核验/);
  assert.equal(f.calls.length, 0);
});

test('an incoming abort reaches the shared verification request signals', async () => {
  const controller = new AbortController();
  const f = fixture({ head: options => {
    assert.equal(options.signal.aborted, true);
    options.signal.throwIfAborted();
  } });
  const req = new Request(ORIGIN + '/api/jobs/32f2a23e', { signal: controller.signal });
  controller.abort(new Error('user-session-aborted-private-reason'));
  const result = await f.verify(job(f.sample), req);
  assert.equal(result.result.verifiedFile, false);
  assert.match(result.result.verificationError, /完整读取/);
  assert.equal(result.result.verificationError.includes('private-reason'), false);
  assert.equal(f.calls.length, 1);
});

test('untrusted media origins and non-file paths are refused before fetching', async () => {
  for (const videoUrl of ['https://untrusted.example/api/files/file.mp4', 'https://fixed.example/index.html']) {
    const f = fixture();
    const result = await f.verify(job(f.sample, { videoUrl }));
    assert.equal(result.result.verifiedFile, false);
    assert.match(result.result.verificationError, /地址无法核验/);
    assert.equal(f.calls.length, 0);
  }
});

test('original-site absolute file links and the supported channel platform aliases are verified', async () => {
  for (const platform of ['channels', 'wechat', 'weixin', 'wechat_channels']) {
    const f = fixture(), upstream = job(f.sample, { videoUrl: ORIGINAL + FILE });
    upstream.platform = platform;
    assert.equal((await f.verify(upstream)).result.verifiedFile, true, platform);
    assert.equal(f.calls[1].url, ORIGINAL + FILE);
  }
  const f = fixture(), upstream = job(f.sample);
  delete upstream.platform;
  assert.equal((await f.verify(upstream)).result.verifiedFile, true);
});

test('unrelated platform and incomplete jobs are returned unchanged without storage or transport calls', async () => {
  const f = fixture();
  const unrelated = job(f.sample);
  unrelated.platform = unrelated.result.platform = 'xiaohongshu';
  unrelated.result.verifiedFile = true;
  const processing = job(f.sample);
  processing.state = 'transfer';
  const withoutResult = { id: 'missing', state: 'done', platform: 'channels' };
  for (const value of [unrelated, processing, withoutResult, null]) {
    assert.equal(await f.verify(value), value);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.entries.size, 0);
});

test('empty and image-only channel results do not assert video-file verification', async () => {
  for (const candidates of [[], [{ kind: 'image', imageUrl: FILE, bytes: 12 }]]) {
    const f = fixture(), upstream = job(f.sample);
    upstream.result.candidates = candidates;
    const result = await f.verify(upstream);
    assert.equal(result.result.verifiedFile, false);
    assert.match(result.result.verificationError, /可核验的视频/);
    assert.equal(f.calls.length, 0);
  }
});

test('Douyin portrait videos are fully read in bounded pieces and receive exact MP4 metadata', async () => {
  const settings = { seconds: 9.7, width: 1080, height: 1920 };
  const sample = movie({ ...settings, dataBytes: 6_524_569 - movie({ ...settings, dataBytes: 0 }).length });
  const f = fixture({ sample }), upstream = job(sample, { duration: 9.7 });
  upstream.platform = upstream.result.platform = 'douyin';
  const result = await f.verify(upstream);
  assert.equal(result.result.verifiedFile, true);
  assert.equal(result.result.verification, 'full-bytes-and-mp4');
  assert.equal(Object.hasOwn(result.result, 'verificationError'), false);
  const candidate = result.result.candidates[0];
  assert.equal(candidate.bytes, 6_524_569);
  assert.equal(candidate.duration, 9.7);
  assert.equal(candidate.width, 1080);
  assert.equal(candidate.height, 1920);
  assert.equal(candidate.codec, 'H264');
  assert.equal(candidate.hasAudio, true);
  assert.deepEqual(f.calls.filter(call => call.method === 'GET').map(call => call.headers.get('range')), [
    `bytes=0-${CHUNK - 1}`, `bytes=${CHUNK}-6524568`,
  ]);
});

test('Douyin image-only and text results are returned unchanged without video verification', async () => {
  for (const candidates of [[], [{ kind: 'image', imageUrl: FILE, bytes: 12 }],
    [{ imageUrl: FILE, downloadUrl: FILE + '?download=1', bytes: 12 }]]) {
    const f = fixture(), upstream = job(f.sample);
    upstream.platform = upstream.result.platform = 'douyin';
    upstream.result.candidates = candidates;
    upstream.result.contentText = '图文内容';
    upstream.result.verifiedFile = true;
    assert.equal(await f.verify(upstream), upstream);
    assert.equal(f.calls.length, 0);
    assert.equal(f.entries.size, 0);
  }
});

test('a Douyin result with a video URL can be verified when its optional kind is missing', async () => {
  const f = fixture(), upstream = job(f.sample);
  upstream.platform = upstream.result.platform = 'douyin';
  delete upstream.result.candidates[0].kind;
  assert.equal((await f.verify(upstream)).result.verifiedFile, true);
  assert.equal(f.calls.length, 2);
});

test('Douyin video verification failures remove the upstream verified claim', async () => {
  const f = fixture({ get: () => new Response('upstream failure', { status: 500 }) }), upstream = job(f.sample);
  upstream.platform = upstream.result.platform = 'douyin';
  upstream.result.verifiedFile = true;
  const result = await f.verify(upstream);
  assert.equal(result.result.verifiedFile, false);
  assert.equal(result.result.verification, 'pending-media-read');
  assert.match(result.result.verificationError, /完整读取/);
});

test('Douyin videos preserve the total 32 MiB preflight budget', async () => {
  const f = fixture(), upstream = job(f.sample, { bytes: 20 * 1024 * 1024 });
  upstream.platform = upstream.result.platform = 'douyin';
  upstream.result.candidates.push({ ...upstream.result.candidates[0], videoUrl: FILE + '?second=1' });
  const result = await f.verify(upstream);
  assert.equal(result.result.verifiedFile, false);
  assert.match(result.result.verificationError, /完整核验/);
  assert.equal(f.calls.length, 0);
});

test('Douyin verification cache is isolated by platform, session and candidate identity', async () => {
  const f = fixture(), channel = job(f.sample), douyin = job(f.sample);
  douyin.platform = douyin.result.platform = 'douyin';
  assert.equal((await f.verify(channel)).result.verifiedFile, true);
  const first = await f.verify(douyin);
  assert.equal(first.result.platform, 'douyin');
  assert.equal(f.calls.length, 4, 'Douyin cannot inherit the channel cache for the same ID and file');
  assert.deepEqual(await f.verify(douyin), first);
  assert.equal(f.calls.length, 4);
  await f.verify(douyin, request('another-session'));
  assert.equal(f.calls.length, 6);
  const changed = structuredClone(douyin);
  changed.result.candidates[0].fileName = 'another-video.mp4';
  await f.verify(changed);
  assert.equal(f.calls.length, 8);
  assert.equal(f.entries.size, 4);
});
