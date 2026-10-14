import test from 'node:test';
import assert from 'node:assert/strict';
import {supportedBrowserRoute,validateResourceUrl,cleanBrowserCandidates,biliInfoFromView} from '../server/browser-resolver.mjs';
import handler,{streamingResolution} from '../netlify/functions/resolve.mjs';

test('browser only navigates exact approved work routes',()=>{
  assert.equal(supportedBrowserRoute('https://v.douyin.com/Z0wh2LKx4MI/').hostname,'v.douyin.com');
  assert.throws(()=>supportedBrowserRoute('https://www.douyin.com/user/123'));
  assert.throws(()=>supportedBrowserRoute('https://www.douyin.com/'));
  assert.throws(()=>supportedBrowserRoute('https://douyin.com.evil.example/video/7568826746301189418'));
  assert.throws(()=>supportedBrowserRoute('https://www.douyin.com:8443/video/7568826746301189418'));
  assert.throws(()=>supportedBrowserRoute('https://user:password@www.douyin.com/video/7568826746301189418'));
});
test('approved resources still reject private or mixed DNS answers',async()=>{
  await assert.rejects(validateResourceUrl('https://lf1-cdn-tos.bytegoofy.com/script.js',{lookupFn:async()=>[{address:'127.0.0.1'}]}));
  await assert.rejects(validateResourceUrl('https://www.douyin.com/script.js',{lookupFn:async()=>[{address:'1.1.1.1'},{address:'10.0.0.2'}]}));
  await assert.rejects(validateResourceUrl('https://evil.example/script.js',{lookupFn:async()=>[{address:'1.1.1.1'}]}));
  await assert.rejects(validateResourceUrl('file:///etc/passwd'));
});
test('validated public DNS is cached only inside the invocation map',async()=>{
  let calls=0;const dnsCache=new Map(),lookupFn=async()=>{calls++;return [{address:'1.1.1.1'}];};
  await validateResourceUrl('https://www.douyin.com/script.js',{lookupFn,dnsCache});
  await validateResourceUrl('https://www.douyin.com/another.js',{lookupFn,dnsCache});
  assert.equal(calls,1);
});
test('candidate cleaning enforces target identity, full format, approved CDN and encryption state',()=>{
  const id='7568826746301189418',base={videoId:id,kind:'video',codec:'h264',title:'target',videoUrl:'https://v26-web.douyinvod.com/video/full.mp4'};
  const items=[base,{...base,videoId:'7676489080318171889',videoUrl:'https://v26-web.douyinvod.com/video/other.mp4'}, {...base,videoUrl:'https://evil.example/full.mp4'}, {...base,videoUrl:'https://v26-web.douyinvod.com/video/full.mp4?start=100'}, {...base,encrypted:true,videoUrl:'https://v26-web.douyinvod.com/video/encrypted.mp4'}, {...base,kind:'hls',videoUrl:'https://v26-web.douyinvod.com/video/playlist.m3u8'}];
  assert.equal(cleanBrowserCandidates(items,id,'douyin').length,1);
});
test('function rejects credential/bridge fields and bounded input before launching Chromium',async()=>{
  const extra=await handler(new Request('https://example.test/.netlify/functions/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageUrl:'https://v.douyin.com/Z0wh2LKx4MI/',cookies:'secret'})}));
  assert.equal(extra.status,400);
  const large=await handler(new Request('https://example.test/.netlify/functions/resolve',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(24001)}));
  assert.equal(large.status,413);
});
test('streamed heartbeat is valid JSON whitespace and final resolver result is preserved',async()=>{
  let finish;const resolver=()=>new Promise(resolve=>{finish=resolve;});
  const response=streamingResolution({pageUrl:'https://v.douyin.com/Z0wh2LKx4MI/'},{resolver,heartbeatMs:5});
  const reader=response.body.getReader(),first=await reader.read();
  assert.equal(new TextDecoder().decode(first.value),'\n');
  const second=await reader.read();assert.equal(new TextDecoder().decode(second.value),'\n');
  finish({error:'platform restricted',standalone:true});
  let text=new TextDecoder().decode(first.value)+new TextDecoder().decode(second.value);
  while(true){const item=await reader.read();if(item.done)break;text+=new TextDecoder().decode(item.value);}
  assert.deepEqual(JSON.parse(text),{error:'platform restricted',standalone:true});
});
test('cancelling the streamed response aborts the resolver and clears its heartbeat',async()=>{
  let signal;const resolver=(_payload,options)=>{signal=options.signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));};
  const response=streamingResolution({pageUrl:'https://v.douyin.com/Z0wh2LKx4MI/'},{resolver,heartbeatMs:5});
  const reader=response.body.getReader();await reader.read();await Promise.resolve();await reader.cancel();
  assert.equal(signal.aborted,true);
});
test('hard completion guard emits actual timeout JSON rather than ending with only heartbeat',async()=>{
  let signal;const resolver=(_payload,options)=>{signal=options.signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));};
  const response=streamingResolution({pageUrl:'https://v.douyin.com/Z0wh2LKx4MI/'},{resolver,heartbeatMs:3,completionTimeoutMs:10});
  const result=await response.json();assert.equal(result.reasonCode,'RESOLVE_TIMEOUT');assert.equal(signal.aborted,true);assert.match(result.error,/超时/);
});
test('Bili native view binds exact case-sensitive BV ID and selected part CID',()=>{
  const bvid='BV1uK42187Uo',data={code:0,data:{bvid,aid:1,cid:100,pages:[{page:1,cid:100,duration:30},{page:2,cid:200,duration:40}],title:'target'}};
  assert.equal(biliInfoFromView(data,bvid,'https://www.bilibili.com/video/'+bvid+'/?p=2').cid,'200');
  assert.equal(biliInfoFromView(data,bvid,'https://www.bilibili.com/video/'+bvid+'/?p=3').unavailablePage,true);
  assert.equal(biliInfoFromView(data,'BV1UK42187Uo','https://www.bilibili.com/video/BV1UK42187Uo/'),null);
});
