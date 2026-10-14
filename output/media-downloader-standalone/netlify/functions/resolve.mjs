import {resolveStandalone,supportedBrowserRoute} from '../../server/browser-resolver.mjs';
import {resolveChannelsWithBrowser} from '../../server/channels-browser.mjs';
import {extractInputUrl} from '../../server/public-resolve.mjs';
import {assertAllowedUrl,platformOf} from '../../server/policy.mjs';
import {getStore} from '@netlify/blobs';
export const config={};
const MAX_BODY=24000;
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const channelsStore=()=>getStore({name:'anma-channels-jobs',consistency:'strong'});
async function startChannelsJob(pageUrl) {
  const jobId=crypto.randomUUID().replace(/-/g,'');
  await channelsStore().setJSON(jobId,{jobId,pageUrl,status:'queued',createdAt:Date.now(),updatedAt:Date.now()});
  return json({async:true,jobId,platform:'channels',standalone:true,needsBridge:false,message:'视频号网页会话已创建，请在页面内完成微信扫码。'});
}
export function streamingResolution(payload,{resolver=resolveStandalone,heartbeatMs=5000,completionTimeoutMs=25000}={}) {
  const abortController=new AbortController(),encoder=new TextEncoder();let interval,completionTimer,closed=false;
  const body=new ReadableStream({
    start(controller) {
      const enqueue=value=>{if(!closed)controller.enqueue(encoder.encode(value));};
      // JSON permits whitespace before the final object. An immediate first byte
      // and periodic whitespace keep the CDN connection active while Chromium
      // resolves; they do not declare parsing or downloading successful.
      enqueue('\n');
      interval=setInterval(()=>{try{enqueue('\n');}catch{closed=true;clearInterval(interval);abortController.abort();}},heartbeatMs);
      completionTimer=setTimeout(()=>{
        if(!closed){enqueue(JSON.stringify({error:'解析等待超时，请稍后重新尝试。',reasonCode:'RESOLVE_TIMEOUT',standalone:true,needsBridge:false}));closed=true;controller.close();clearInterval(interval);abortController.abort();}
      },completionTimeoutMs);
      void Promise.resolve().then(()=>resolver(payload,{signal:abortController.signal})).then(result=>{
        if(!closed){enqueue(JSON.stringify(result));closed=true;controller.close();}
      }).catch(()=>{
        if(!closed){enqueue(JSON.stringify({error:'解析服务暂不可用，请稍后重试。',standalone:true,needsBridge:false}));closed=true;controller.close();}
      }).finally(()=>{clearInterval(interval);clearTimeout(completionTimer);});
    },
    cancel() {closed=true;clearInterval(interval);clearTimeout(completionTimer);abortController.abort();}
  });
  return new Response(body,{headers});
}
export function streamingChannelsResolution(pageUrl,{resolver=resolveChannelsWithBrowser,heartbeatMs=3000,completionTimeoutMs=27500}={}) {
  const abortController=new AbortController(),encoder=new TextEncoder();let interval,completionTimer,closed=false;
  const body=new ReadableStream({
    start(controller) {
      const enqueue=value=>{if(!closed)controller.enqueue(encoder.encode(value));};
      const event=value=>enqueue(JSON.stringify(value)+'\n');
      event({type:'status',message:'正在准备视频号网页会话…'});
      interval=setInterval(()=>{try{event({type:'heartbeat'});}catch{closed=true;clearInterval(interval);abortController.abort();}},heartbeatMs);
      completionTimer=setTimeout(()=>{
        if(!closed){event({type:'result',result:{error:'视频号网页会话等待超时，请重新解析并在二维码出现后及时扫码。',reasonCode:'CHANNELS_TIMEOUT',platform:'channels',standalone:true,needsBridge:false,candidates:[]}});closed=true;controller.close();clearInterval(interval);abortController.abort();}
      },completionTimeoutMs);
      void Promise.resolve().then(()=>resolver(pageUrl,{signal:abortController.signal,onEvent:event})).then(result=>{
        if(!closed){event({type:'result',result});closed=true;controller.close();}
      }).catch(()=>{
        if(!closed){event({type:'result',result:{error:'视频号网页解析服务暂不可用，请稍后重试。',reasonCode:'CHANNELS_UNAVAILABLE',platform:'channels',standalone:true,needsBridge:false,candidates:[]}});closed=true;controller.close();}
      }).finally(()=>{clearInterval(interval);clearTimeout(completionTimer);});
    },
    cancel(){closed=true;clearInterval(interval);clearTimeout(completionTimer);abortController.abort();}
  });
  return new Response(body,{headers:{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-accel-buffering':'no'}});
}
export default async function handler(request) {
  if(request.method!=='POST') return json({error:'请使用 POST 解析分享链接。'},405);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||'')) return json({error:'请求需要使用 JSON 格式。'},415);
  if(Number(request.headers.get('content-length')||0)>MAX_BODY) return json({error:'分享内容过长。'},413);
  try {
    const reader=request.body?.getReader();if(!reader)return json({error:'分享内容为空。'},400);
    const decoder=new TextDecoder();let bytes=0,text='';
    try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>MAX_BODY)return json({error:'分享内容过长。'},413);text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}finally{try{await reader.cancel();}catch{}}
    const payload=JSON.parse(text);
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>key!=='pageUrl')) return json({error:'请求只支持 pageUrl 分享内容。'},400);
    const pageUrl=extractInputUrl(payload.pageUrl),platform=platformOf(pageUrl);
    if(platform==='channels') return startChannelsJob(pageUrl);
    if(['douyin','bilibili','xiaohongshu'].includes(platform)) supportedBrowserRoute(pageUrl,platform);
    else if(platform!=='channels') assertAllowedUrl(pageUrl,'media');
    return streamingResolution({pageUrl});
  }catch(error) {return json({error:error instanceof SyntaxError?'请求 JSON 无效。':error?.message||'链接解析失败，请重试。',standalone:true,needsBridge:false},400);}
}
