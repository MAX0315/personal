import test from 'node:test';
import assert from 'node:assert/strict';
import { inputUrl, isXhsInput, officialFetch, resolveXhs, MOBILE_UA } from '../server/xhs.mjs';

const ID = '675abcdef0123456789abcde';
const OTHER = '675abcdef0123456789abcdf';
const SHORT = 'https://xhslink.cn/o/70a9Csr9Fob';
const PAGE = `https://www.xiaohongshu.com/discovery/item/${ID}?xsec_token=a%2Bb%2Fc&xsec_source=app_share`;
const CDN = 'https://sns-video-bd.xhscdn.com/pre_post/video/sample.mp4';
const SHARE = `这样的两室一厅有人喜欢吗～拱墅区转租 个人工作原因... ${SHORT} 复制内容，然后进入【小红书】查看相关笔记。`;

function box(type, ...parts) {
  const data = Buffer.concat(parts), header = Buffer.alloc(8);
  header.writeUInt32BE(data.length + 8); header.write(type, 4);
  return Buffer.concat([header, data]);
}
function sampleMp4() {
  const tkhd = Buffer.alloc(84); tkhd.writeUInt32BE(720 * 65536, 76); tkhd.writeUInt32BE(1280 * 65536, 80);
  const mdhd = Buffer.alloc(24); mdhd.writeUInt32BE(1000, 12); mdhd.writeUInt32BE(2500, 16);
  const hdlr = Buffer.alloc(24); hdlr.write('vide', 8);
  const stsd = Buffer.alloc(8); stsd.writeUInt32BE(1, 4);
  return Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isom', 'latin1')),
    box('moov', box('trak', box('tkhd', tkhd), box('mdia', box('mdhd', mdhd), box('hdlr', hdlr), box('minf', box('stbl', box('stsd', stsd, box('avc1', Buffer.alloc(78)))))))),
    box('mdat', Buffer.from([1, 2, 3, 4]))]);
}
function html({ id = ID, duration = 2.5, urls = [CDN], canonical = '', desc = '个人工作原因转租。' } = {}) {
  const note = { noteId: id, type: 'video', title: '这样的两室一厅有人喜欢吗', desc,
    video: { capa: { duration }, media: { stream: { h264: urls.map(masterUrl => ({ masterUrl, videoCodec: 'h264' })) } } } };
  return `<html>${canonical ? `<link rel="canonical" href="${canonical}">` : ''}<script>window.__INITIAL_STATE__=${JSON.stringify({ noteData: { data: { noteData: note } } })};</script></html>`;
}
function scripted(steps) {
  const calls = [];
  const transport = async (url, options) => {
    const step = steps[calls.length]; calls.push({ url, options });
    assert.ok(step, `unexpected transport call: ${url}`);
    if (step.url) assert.equal(url, step.url);
    return new Response(step.body ?? null, { status: step.status ?? 200, headers: step.headers ?? {} });
  };
  return { transport, calls };
}
const redirect = (location = PAGE) => ({ url: SHORT, status: 302, headers: { location } });
const page = (body = html(), url = PAGE) => ({ url, body, headers: { 'content-type': 'text/html; charset=utf-8' } });
const video = (body = sampleMp4(), url = CDN, headers = {}) => ({ url, body, headers: { 'content-type': 'video/mp4', 'content-length': String(body.length), ...headers } });

test('recognizes the entire pasted share text and xhslink.cn', () => {
  assert.equal(inputUrl(SHARE).href, SHORT);
  assert.equal(inputUrl(`分享 ${SHORT}）。`).href, SHORT);
  assert.equal(isXhsInput(SHARE), true);
  assert.equal(isXhsInput('https://www.xiaohongshu.com/explore/' + ID), true);
  assert.equal(isXhsInput('https://xhslink.cn.attacker.example/o/abc'), false);
  assert.equal(isXhsInput('https://www.douyin.com/video/1234'), false);
  assert.throws(() => inputUrl('只有文字'), /没有完整链接/);
  assert.throws(() => inputUrl('a'.repeat(20001)), /有效/);
});

test('uses manual redirects and preserves the complete signed official query', async () => {
  const mock = scripted([redirect(), page()]);
  const result = await officialFetch(SHORT, 'page', { transport: mock.transport });
  assert.equal(result.url, PAGE);
  for (const call of mock.calls) {
    assert.equal(call.options.redirect, 'manual');
    assert.equal(call.options.headers['User-Agent'], MOBILE_UA);
    assert.equal(call.options.headers['Accept-Encoding'], 'identity');
    assert.equal(call.options.headers.Cookie, undefined);
  }
  assert.equal(new URL(mock.calls[1].url).searchParams.get('xsec_token'), 'a+b/c');
  const relative = scripted([{ status: 307, headers: { location: `/explore/${ID}?xsec_token=relative%2Ftoken` } }, { body: html() }]);
  const followed = await officialFetch(`https://www.xiaohongshu.com/discovery/item/${ID}`, 'page', { transport: relative.transport });
  assert.equal(followed.url, `https://www.xiaohongshu.com/explore/${ID}?xsec_token=relative%2Ftoken`);
});

test('rejects page and media redirect escapes before contacting an unapproved host', async () => {
  for (const [initial, kind, target] of [
    [SHORT, 'page', 'https://attacker.example/private'],
    [SHORT, 'page', 'http://127.0.0.1/admin'],
    [CDN, 'media', 'https://sns-video-bd.xhscdn.com.attacker.example/video'],
    [CDN, 'media', 'https://www.xiaohongshu.com/login'],
    [CDN, 'media', 'https://sns-video-bd.xhscdn.com:8443/video'],
    [SHORT, 'page', 'https://name:password@www.xiaohongshu.com/explore/' + ID],
  ]) {
    const mock = scripted([{ status: 302, headers: { location: target } }]);
    await assert.rejects(officialFetch(initial, kind, { transport: mock.transport }), /不受支持/);
    assert.equal(mock.calls.length, 1);
  }
});

test('upgrades official CDN URLs to TLS and limits redirect loops', async () => {
  const secure = scripted([{ url: CDN, body: sampleMp4() }]);
  await officialFetch(CDN.replace('https:', 'http:'), 'media', { transport: secure.transport });
  const loop = scripted(Array.from({ length: 7 }, () => ({ status: 302, headers: { location: SHORT } })));
  await assert.rejects(officialFetch(SHORT, 'page', { transport: loop.transport }), /跳转次数过多/);
  assert.equal(loop.calls.length, 7);
});

test('resolves a signed mobile share into verified metadata and exact note text', async () => {
  const mock = scripted([redirect(), page(), video()]);
  const result = await resolveXhs(SHARE, { transport: mock.transport });
  assert.equal(result.videoId, ID);
  assert.equal(result.contentText, '个人工作原因转租。');
  assert.equal(result.title, '这样的两室一厅有人喜欢吗');
  assert.equal(result.pageUrl, SHORT);
  assert.equal(result.verifiedFile, true);
  assert.equal(result.verification, 'container-and-length');
  assert.equal(result.candidate.duration, 2.5);
  assert.equal(result.candidate.width, 720);
  assert.equal(result.candidate.height, 1280);
  assert.equal(result.candidate.videoCodec, 'h264');
  assert.equal(result.candidate.hasAudio, false);
  assert.deepEqual(result.bytes, new Uint8Array(sampleMp4()));
});

test('rejects login pages, a redirected different note, and mismatched page state', async () => {
  const login = scripted([redirect('https://www.xiaohongshu.com/login'), { body: '<html>请登录</html>' }]);
  await assert.rejects(resolveXhs(SHARE, { transport: login.transport }), /目标笔记/);
  assert.equal(login.calls.length, 2);
  const changed = scripted([{ status: 302, headers: { location: PAGE.replace(ID, OTHER) } }, { body: html({ id: OTHER }) }]);
  await assert.rejects(resolveXhs(PAGE, { transport: changed.transport }), /目标笔记/);
  for (const body of [html({ id: OTHER }), html({ canonical: PAGE.replace(ID, OTHER) }), '<html>登录后查看</html>']) {
    const mismatch = scripted([redirect(), page(body)]);
    await assert.rejects(resolveXhs(SHARE, { transport: mismatch.transport }), /暂未提供/);
    assert.equal(mismatch.calls.length, 2);
  }
});

test('never treats HTML as video even with a video/mp4 content type', async () => {
  const body = Buffer.from('<html>login required</html>');
  const mock = scripted([redirect(), page(), video(body)]);
  await assert.rejects(resolveXhs(SHARE, { transport: mock.transport }), /无法完整读取/);
  const backup = CDN.replace('sample.mp4', 'backup.mp4');
  const retry = scripted([redirect(), page(html({ urls: [CDN, backup] })), video(body), video(sampleMp4(), backup)]);
  assert.equal((await resolveXhs(SHARE, { transport: retry.transport })).candidate.format, 'mp4');
  assert.equal(retry.calls.length, 4);
});

test('rejects incomplete transfers, mismatched durations, oversized responses and partial HTTP video', async () => {
  const bytes = sampleMp4();
  for (const step of [video(bytes, CDN, { 'content-length': String(bytes.length + 1) }),
    video(bytes.subarray(0, bytes.length - 1)),
    video(bytes, CDN, { 'content-length': String(81 * 1024 * 1024) }),
    { ...video(), status: 206 }]) {
    const mock = scripted([redirect(), page(), step]);
    await assert.rejects(resolveXhs(SHARE, { transport: mock.transport }), /无法完整读取/);
  }
  const wrongDuration = scripted([redirect(), page(html({ duration: 20 })), video()]);
  await assert.rejects(resolveXhs(SHARE, { transport: wrongDuration.transport }), /无法完整读取/);
  const tooBig = scripted([redirect(), { ...page(), headers: { 'content-length': String(13 * 1024 * 1024) } }]);
  await assert.rejects(resolveXhs(SHARE, { transport: tooBig.transport }), /大小上限/);
});
