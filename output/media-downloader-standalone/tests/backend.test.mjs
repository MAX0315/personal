import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedUrl, parseSafeUrl, isPublicIp, safeFileName } from '../server/policy.mjs';
import { createSafeFetch, boundedText } from '../server/safe-fetch.mjs';
import { resolveInput } from '../server/public-resolve.mjs';
import { handleMedia } from '../netlify/edge-functions/media.mjs';
import handler from '../netlify/functions/resolve.mjs';

const page = 'https://www.douyin.com/video/7123456789012345678';
const cdn = 'https://v3.douyinvod.com/video/test.mp4?token=a%2Fb&expires=123';
const mp4Bytes = new Uint8Array([0,0,0,32,102,116,121,112,109,112,52,50,0,0,0,0,109,112,52,50,105,115,111,109,0,0,0,0,0,0,0,0,0,0,0,8,109,100,97,116]);
const jpegBytes = new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1,0,0,0,0]);
const publicLookup = async () => [{ address:'8.8.8.8', family:4 }];
function response(body, { url = page, status = 200, type = 'text/html', headers = {} } = {}) {
  const result = new Response(body, { status, headers:{ 'Content-Type':type, ...headers } });
  Object.defineProperty(result, 'url', { value:url });
  return result;
}
function apiRequest(data, opts = {}) {
  return new Request('https://tool.example/api/resolve', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(data), ...opts });
}
function mediaRequest(url = cdn, query = '', headers = {}) {
  return new Request('https://tool.example/api/media?url=' + encodeURIComponent(url) + query, { headers });
}

test('private, link local, reserved and mapped IP addresses are rejected', () => {
  for (const address of ['127.0.0.1','10.0.0.1','172.16.2.3','192.168.2.3','169.254.169.254','100.64.1.2','0.0.0.0','224.1.2.3','::1','fe80::1','fd00::1','::ffff:127.0.0.1','2001:db8::1','999.1.1.1']) assert.equal(isPublicIp(address), false, address);
  for (const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) assert.equal(isPublicIp(address), true, address);
});
test('domain boundaries, credentials, IP hosts and custom ports are rejected', () => {
  for (const url of ['https://douyin.com.evil.example/video/1','https://localhost/test','https://127.0.0.1/test','https://www.douyin.com:1234/test','file:///tmp/test','https://name:password@www.douyin.com/video/1','https://www.douyin.com./video/1']) assert.throws(() => assertAllowedUrl(url));
  assert.throws(() => assertAllowedUrl('https://notdouyinvod.com/test.mp4','media'));
  assert.throws(() => assertAllowedUrl('https://v.douyinvod.com.evil.example/test.mp4','media'));
  assert.throws(() => assertAllowedUrl('https://api.bilibili.com/evil','api'));
  assert.throws(() => assertAllowedUrl(cdn + '&start=1','media'));
  assert.equal(assertAllowedUrl(cdn,'media').href, cdn);
  assert.equal(assertAllowedUrl('https://v5-dy-ov-experiment.zjcdn.com/video/target.mp4','media').hostname,'v5-dy-ov-experiment.zjcdn.com');
  assert.throws(() => assertAllowedUrl('https://v5.zjcdn.com.evil.example/video/target.mp4','media'));
});
test('DNS is checked before request and a public address is pinned', async () => {
  let requested = false;
  const privateFetch = createSafeFetch({ lookupFn:async () => [{ address:'192.168.1.2', family:4 }], requestFn:async () => { requested = true; } });
  await assert.rejects(privateFetch(page), /非公开/); assert.equal(requested, false);
  const publicFetch = createSafeFetch({ lookupFn:publicLookup, requestFn:async (url, options, address) => { assert.equal(address.address,'8.8.8.8'); assert.equal(options.headers.Cookie, undefined); return response('ok'); } });
  assert.equal(await (await publicFetch(page)).text(), 'ok');
});
test('redirects cannot leave platform whitelist or point into private DNS', async () => {
  let calls = 0;
  const escape = createSafeFetch({ lookupFn:publicLookup, requestFn:async () => { calls++; return response('',{ status:302, headers:{ Location:'https://example.com/secret' } }); } });
  await assert.rejects(escape(page), /目前支持/); assert.equal(calls,1);
  const rebound = createSafeFetch({ lookupFn:async host => [{ address:host === 'www.douyin.com' ? '8.8.8.8' : '127.0.0.1', family:4 }], requestFn:async () => response('',{ status:302, headers:{ Location:'https://m.douyin.com/video/7123456789012345678' } }) });
  await assert.rejects(rebound(page), /非公开/);
});
test('bounded text rejects declared and chunked oversized responses', async () => {
  await assert.rejects(boundedText(response('large',{ headers:{ 'Content-Length':'100' } }),20), /上限/);
  await assert.rejects(boundedText(response('0123456789'),5), /上限/);
});
test('public direct media and pasted share text resolve without fetching', async () => {
  const result = await resolveInput({ pageUrl:'看看这条视频 ' + cdn + '。' },{ transport:() => { throw new Error('should not fetch'); } });
  assert.equal(result.candidates[0].videoUrl,cdn); assert.equal(result.platform,'direct'); assert.equal(result.verifiedMedia,false);
  await assert.rejects(resolveInput({ pageUrl:'https://evil.example/a.mp4' }), /目前支持/);
});
test('Restricted Channels share fails honestly without fetching or accepting user cookies', async () => {
  const result = await resolveInput({ pageUrl:'https://weixin.qq.com/sph/example' },{ transport:() => { throw new Error('should not fetch'); } });
  assert.equal(result.permissionRequired,true); assert.equal(result.platform,'channels'); assert.match(result.error,/权限/);
  assert.equal((await handler(apiRequest({ pageUrl:page, cookies:'private' }))).status,400);
});
test('exact Douyin detail identity resolves and does not execute remote script', async () => {
  const detail = { aweme_detail:{ aweme_id:'7123456789012345678', desc:'目标作品', video:{ play_addr:{ url_list:[cdn] }, duration:15000, width:720, height:1280 } } };
  const html = '<script>throw new Error("never execute");</script><script type="application/json">' + JSON.stringify(detail) + '</script>';
  const result = await resolveInput({ pageUrl:page },{ transport:async () => response(html) });
  assert.equal(result.candidates.length,1); assert.equal(result.candidates[0].videoId,'7123456789012345678'); assert.equal(result.candidates[0].duration,15);
  const wrong = await resolveInput({ pageUrl:page },{ transport:async () => response(html.replaceAll('7123456789012345678','7123456789012345679')) });
  assert.equal(wrong.requiresPage,true); assert.equal(wrong.candidates,undefined);
});
test('Xiaohongshu public page extracts exact note playback URL', async () => {
  const noteId = '66abcdef0000000012345678';
  const videoUrl = 'https://sns-video-bd.xhscdn.com/stream/abc.mp4?signature=abc';
  const state = { note:{ noteDetailMap:{ [noteId]:{ note:{ noteId, type:'video', title:'笔记视频', video:{ media:{ stream:{ h264:[{ masterUrl:videoUrl, width:720, height:1280, duration:15000 }] } } } } } } } };
  const url = 'https://www.xiaohongshu.com/explore/' + noteId;
  const result = await resolveInput({ pageUrl:url },{ transport:async () => response('<script>window.__INITIAL_STATE__ = ' + JSON.stringify(state) + '</script>',{ url }) });
  assert.equal(result.candidates[0].videoUrl,videoUrl); assert.equal(result.platform,'xiaohongshu');
});
test('Bilibili API fallback selects a single MP4 and retains actual quality', async () => {
  const url = 'https://www.bilibili.com/video/BV1xx411c7mD';
  const videoUrl = 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/video.mp4?deadline=123';
  const transport = async address => {
    if (address.includes('/x/web-interface/view')) return response(JSON.stringify({ code:0,data:{ bvid:'BV1xx411c7mD',aid:100,cid:200,title:'测试作品',pages:[{ page:1,cid:200,duration:10 }] } }),{ url:address,type:'application/json' });
    if (address.includes('/x/player/playurl')) return response(JSON.stringify({ code:0,data:{ quality:32,timelength:10000,durl:[{ url:videoUrl }] } }),{ url:address,type:'application/json' });
    return response('<html>公开页面</html>',{ url });
  };
  const result = await resolveInput({ pageUrl:url },{ transport });
  assert.equal(result.candidates[0].videoUrl,videoUrl); assert.equal(result.candidates[0].quality,32); assert.equal(result.method,'playurl-mp4');
});
test('a missing requested Bilibili part never falls back to the first part', async () => {
  const url = 'https://www.bilibili.com/video/BV1xx411c7mD?p=2';
  let playRequested = false;
  const transport = async address => {
    if (address.includes('/x/web-interface/view')) return response(JSON.stringify({ code:0,data:{ bvid:'BV1xx411c7mD',cid:200,pages:[{page:1,cid:200,duration:10}] } }),{url:address,type:'application/json'});
    if (address.includes('/x/player/playurl')) playRequested = true;
    return response('<script>window.__INITIAL_STATE__ = {"bvid":"BV1xx411c7mD","cid":200,"pages":[{"page":1,"cid":200}]}</script>',{url});
  };
  const result = await resolveInput({pageUrl:url},{transport});
  assert.equal(result.candidates,undefined); assert.equal(result.invalidPage,true); assert.equal(playRequested,false); assert.match(result.error,/分集不存在/);
});
test('DASH, sequential segments and non-whitelisted candidate sources are excluded', async () => {
  const url = 'https://www.bilibili.com/video/BV1xx411c7mD';
  const data = { code:0,data:{ durl:[{ url:'https://v.bilivideo.com/one.mp4' },{ url:'https://v.bilivideo.com/two.mp4' }],dash:{ video:[{ baseUrl:'https://v.bilivideo.com/one.m4s' }] } } };
  const transport = async address => address.includes('/x/') ? response(JSON.stringify(data),{ url:address,type:'application/json' }) : response('<script>window.__INITIAL_STATE__ = {"bvid":"BV1xx411c7mD","cid":200}</script>',{ url });
  const result = await resolveInput({ pageUrl:url },{ transport }); assert.equal(result.requiresPage,true);
  const foreign = { aweme_detail:{ aweme_id:'7123456789012345678',video:{ play_addr:{ url_list:['https://evil.example/movie.mp4'] } } } };
  const blocked = await resolveInput({ pageUrl:page },{ transport:async () => response('<script type="application/json">' + JSON.stringify(foreign) + '</script>') });
  assert.equal(blocked.requiresPage,true);
});
test('HTTP function validates request method, content type, malformed body and oversized body', async () => {
  assert.equal((await handler(new Request('https://tool.example/api/resolve'))).status,405);
  assert.equal((await handler(apiRequest({}, { headers:{ 'Content-Type':'text/plain' } }))).status,415);
  assert.equal((await handler(apiRequest({}, { body:'{' }))).status,400);
  assert.equal((await handler(apiRequest({ pageUrl:'a'.repeat(25000) }))).status,413);
  const result = await handler(apiRequest({ pageUrl:'https://media.w3.org/2010/05/sintel/trailer.mp4' })); assert.equal(result.status,200); assert.equal((await result.json()).candidates[0].kind,'video');
});
test('Edge media streaming preserves range and signed URL, uses real content type and safe attachment name', async () => {
  let upstream;
  const transport = async (url,options) => { upstream = { url,options }; return response(mp4Bytes,{ url,status:206,type:'video/mp4',headers:{ 'Content-Range':'bytes 0-39/100','Content-Length':'40','Accept-Ranges':'bytes' } }); };
  const res = await handleMedia(mediaRequest(cdn,'&download=1&filename=' + encodeURIComponent('视频/作品.png'),{ Range:'bytes=0-39',Cookie:'private' }),{ transport });
  assert.equal(upstream.url,cdn); assert.equal(upstream.options.headers.get('Range'),'bytes=0-39'); assert.equal(upstream.options.headers.get('Cookie'),null);
  assert.equal(res.status,206); assert.equal(res.headers.get('content-range'),'bytes 0-39/100'); assert.match(res.headers.get('content-disposition'),/\.mp4/); assert.deepEqual(new Uint8Array(await res.arrayBuffer()),mp4Bytes);
});
test('Edge will not save HTML, JSON or image as MP4 and reports expired media', async () => {
  for (const type of ['text/html','application/json','image/jpeg','application/octet-stream']) {
    const res = await handleMedia(mediaRequest(),{ transport:async () => response('bad',{ type }) }); assert.equal(res.status,422,type);
  }
  const expired = await handleMedia(mediaRequest(),{ transport:async () => response('forbidden',{ status:403 }) }); assert.equal(expired.status,502); assert.match((await expired.json()).error,/过期/);
});
test('Edge image mode downloads as image and refuses unsafe redirects/ranges/private DNS', async () => {
  const image = await handleMedia(mediaRequest('https://p3.douyinpic.com/image.jpeg','&kind=image&download=1'),{ transport:async () => response(jpegBytes,{ type:'image/jpeg' }) });
  assert.equal(image.status,200); assert.match(image.headers.get('content-disposition'),/\.jpg/);
  const redirect = await handleMedia(mediaRequest(),{ transport:async () => response('',{ status:302,headers:{ Location:'http://169.254.169.254/latest/meta-data' } }) }); assert.equal(redirect.status,400);
  const dns = await handleMedia(mediaRequest(),{ resolveDns:async () => ['127.0.0.1'],transport:() => { throw new Error('never request'); } }); assert.equal(dns.status,400);
  const range = await handleMedia(mediaRequest(cdn,'',{ Range:'bytes=0-1,3-4' }),{ transport:() => { throw new Error('never request'); } }); assert.equal(range.status,416);
});
test('Edge binary CDN responses require valid container prefix; full partial responses are refused', async () => {
  const mp4 = await handleMedia(mediaRequest(cdn,'&download=1'),{ transport:async () => response(mp4Bytes,{ type:'application/octet-stream' }) });
  assert.equal(mp4.status,200); assert.equal(mp4.headers.get('content-type'),'video/mp4'); assert.deepEqual(new Uint8Array(await mp4.arrayBuffer()),mp4Bytes);
  const raw = await handleMedia(mediaRequest(cdn,'&download=1'),{ transport:async () => response(new Uint8Array(40),{ type:'video/mp4' }) }); assert.equal(raw.status,422);
  const partial = await handleMedia(mediaRequest(cdn,'&download=1'),{ transport:async () => response(mp4Bytes,{ type:'video/mp4',status:206,headers:{ 'Content-Range':'bytes 0-39/100' } }) }); assert.equal(partial.status,422);
  const middle = await handleMedia(mediaRequest(cdn,'',{ Range:'bytes=100-200' }),{ transport:async () => response(new Uint8Array(101),{ type:'video/mp4',status:206,headers:{ 'Content-Range':'bytes 100-200/300' } }) }); assert.equal(middle.status,206);
});
test('filename sanitization preserves Chinese and handles Windows reserved names', () => {
  assert.equal(safeFileName('../作品.jpg','mp4'),'_作品.mp4'); assert.equal(safeFileName('CON.mp4','mp4'),'_CON.mp4');
  assert.equal(parseSafeUrl(cdn + '#fragment').href,cdn);
});
