import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDouyinShortLink} from '../server/douyin-short-link.mjs';
const SHARE='9.76 复制打开抖音，看看【祈枝枝o.o的作品】你好 我要三份草莓小蛋糕⚡️ https://v.douyin.com/LHRdu-1AjXs/ 12/17 XMj:/ b@n.qE :2pm';
const ID='7693770573902984049';
const redirect=location=>new Response('share page',{status:302,headers:{location}});

test('expands the real hyphenated share caption from Location without loading the landing page',async()=>{
 const calls=[];let canceled=false;
 const transport=async(url,options)=>{
  calls.push({url,options});
  return new Response(new ReadableStream({cancel(){canceled=true;}}),{status:302,headers:{location:`https://www.iesdouyin.com/share/video/${ID}/?share_token=private-value`}});
 };
 const result=await resolveDouyinShortLink(SHARE,{transport});
 assert.deepEqual(result,{videoId:ID,type:'video',canonicalUrl:`https://www.douyin.com/video/${ID}`});
 assert.equal(calls.length,1);assert.equal(canceled,true);
 assert.equal(calls[0].url,'https://v.douyin.com/LHRdu-1AjXs/');
 assert.equal(calls[0].options.redirect,'manual');
 assert.ok(calls[0].options.signal instanceof AbortSignal);
 assert.equal(calls[0].options.headers.Cookie,undefined);
});
test('ignores non-short input and keeps direct links on the existing path',async()=>{
 for(const input of ['invalid','https://www.douyin.com/video/'+ID,'https://xhslink.cn/o/70a9Csr9Fob']) {
  assert.equal(await resolveDouyinShortLink(input,{transport:()=>{throw Error('must not fetch');}}),null);
 }
});
test('preserves the exact large integer and distinguishes image posts',async()=>{
 for(const type of ['note','slides']){
  const result=await resolveDouyinShortLink(SHARE,{transport:async()=>redirect(`https://www.iesdouyin.com/share/${type}/${ID}/`)});
  assert.equal(result.videoId,ID);assert.equal(result.canonicalUrl,`https://www.douyin.com/note/${ID}`);
 }
});
test('rejects non-official redirect hosts, credentials, ports and conflicting identities before fetching them',async()=>{
 for(const target of [`https://www.douyin.com.evil.test/video/${ID}`,`https://user:secret@www.douyin.com/video/${ID}`,`https://127.0.0.1/video/${ID}`,`https://www.douyin.com:8443/video/${ID}`,`https://www.douyin.com/video/${ID}?aweme_id=7693770573902984050`]){
  let calls=0;
  await assert.rejects(resolveDouyinShortLink(SHARE,{transport:async()=>{calls++;return redirect(target);}}),/跳转异常|标识不一致/);
  assert.equal(calls,1);
 }
});
test('only accepts a confirmed official path ID, never a random query or a short page body',async()=>{
 for(const response of [redirect('https://www.douyin.com/?modal_id='+ID),new Response(`<a href="https://www.douyin.com/video/${ID}">recommendation</a>`),new Response(null,{status:302})]){
  let calls=0;
  await assert.rejects(resolveDouyinShortLink(SHARE,{transport:async()=>{calls++;return calls===1?response:new Response('not a work');}}),/暂未返回作品地址/);
 }
});
test('handles relative official redirects and detects cycles',async()=>{
 let calls=0;
 const result=await resolveDouyinShortLink(SHARE,{transport:async()=>redirect(++calls===1?'/Other_share/':`https://www.douyin.com/video/${ID}`)});
 assert.equal(result.videoId,ID);assert.equal(calls,2);
 await assert.rejects(resolveDouyinShortLink(SHARE,{transport:async()=>redirect('/LHRdu-1AjXs/')}),/循环跳转/);
});
test('caps redirect hops and converts cancellation into a Chinese retry message',async()=>{
 let calls=0;
 await assert.rejects(resolveDouyinShortLink(SHARE,{transport:async()=>redirect('/share_'+ ++calls +'/')}),/次数过多/);
 assert.equal(calls,5);
 const controller=new AbortController();controller.abort();
 await assert.rejects(resolveDouyinShortLink(SHARE,{signal:controller.signal,transport:async(url,{signal})=>{signal.throwIfAborted();}}),/解析超时/);
});
