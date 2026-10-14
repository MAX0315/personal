import { randomBytes, createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { isXhsInput, resolveXhs, inputUrl } from '../../server/xhs.mjs';
import { handleLegacyMedia } from '../../server/legacy-media.mjs';
import { verifyLegacyJob } from '../../server/legacy-verify.mjs';
import { resolveDouyinShortLink } from '../../server/douyin-short-link.mjs';

export const config = {path:['/api/jobs','/api/jobs/:id','/api/jobs/:id/cancel','/api/status','/api/login','/api/logout','/api/browser-shot','/api/files/*']};
const ORIGINAL = 'https://anma-media-workbench-20261014.netlify.app';
const VERSION = '2.5.3-web';
const TTL = 60 * 60 * 1000;
const COOKIE = 'anma_xhs_session';
const defaults = () => getStore({name:'anma-xhs-mobile',consistency:'strong'});
const json = (data,status=200,headers={}) => Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
function ownerOf(request) { const value = request.headers.get('cookie')?.match(/(?:^|;\s*)anma_xhs_session=([a-f\d]{64})(?:;|$)/)?.[1]; return value || ''; }
function cookie(owner) { return `${COOKIE}=${owner}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`; }
function publicJob(record) { const {owner,expiresAt,sha256,...job} = record; return job; }
function originalCookies(value='') {return value.split(';').filter(part=>!part.trim().startsWith(COOKIE+'=')).join(';');}
export function createApi({storeFactory=defaults,transport=fetch,resolver=resolveXhs,shortResolver=resolveDouyinShortLink}={}) {
  async function proxy(request) {
    const source = new URL(request.url), target = new URL(source.pathname+source.search,ORIGINAL);
    const headers = new Headers();
    for (const name of ['accept','content-type','range','if-range']) { const value = request.headers.get(name); if(value)headers.set(name,value); }
    const cookies = originalCookies(request.headers.get('cookie') || ''); if(cookies)headers.set('cookie',cookies);
    if(request.headers.has('origin'))headers.set('origin',ORIGINAL);
    const response = await transport(target.href,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),redirect:'manual',signal:AbortSignal.timeout(55000)});
    const outgoing = new Headers(response.headers); outgoing.delete('content-encoding'); outgoing.delete('content-length');
    outgoing.set('cache-control','no-store');
    const setCookies = response.headers.getSetCookie?.() || (response.headers.get('set-cookie')?[response.headers.get('set-cookie')]:[]);
    if(setCookies.length){outgoing.delete('set-cookie');for(const value of setCookies)outgoing.append('set-cookie',value.replace(/;\s*Domain=\.?anma-media-workbench-20261014\.netlify\.app/ig,''));}
    return new Response(response.body,{status:response.status,headers:outgoing});
  }
  async function ownedRecord(request,id) {
    if(!/^xhs-[a-f\d]{32}$/.test(id))return null;
    const store=storeFactory(), record=await store.get('jobs/'+id,{type:'json'});
    if(!record||record.owner!==ownerOf(request))return null;
    if(record.expiresAt<Date.now()){await Promise.all([store.delete('jobs/'+id),store.delete('files/'+id)]);return null;}
    return record;
  }
  return async function handler(request) {
    const url=new URL(request.url), path=url.pathname;
    try {
      if(path==='/api/status'&&request.method==='GET') {
        let response,data;
        try{response=await proxy(request);data=await response.json();}catch{data={ready:true,cloud:true,login:{remembered:false},logins:{channels:{remembered:false},xiaohongshu:{remembered:false}},browser:{available:true},activeJobId:null,lastJobId:null};}
        const owner=ownerOf(request);
        if(owner){const last=await storeFactory().get('sessions/'+owner,{type:'json'});if(last?.expiresAt>Date.now()&&last.id)data.lastJobId=last.id;}
        return json({...data,version:VERSION,xhsMobileShare:true},200,response?.headers || {});
      }
      const file=/^\/api\/files\/xhs\/(xhs-[a-f\d]{32})\/video\.mp4$/.exec(path);
      if(file&&['GET','HEAD'].includes(request.method)) {
        const record=await ownedRecord(request,file[1]);if(!record)return json({error:'文件或会话已过期，请重新提取。'},404);
        const buffer=await storeFactory().get('files/'+file[1],{type:'arrayBuffer'});if(!buffer)return json({error:'文件已过期，请重新提取。'},404);
        const bytes=new Uint8Array(buffer),total=bytes.byteLength;
        const headers={'content-type':'video/mp4','cache-control':'private, no-store','accept-ranges':'bytes','x-content-type-options':'nosniff',etag:'"'+record.sha256+'"'};
        const ifRange=request.headers.get('if-range');
        const range=ifRange&&ifRange!==headers.etag?null:request.headers.get('range');
        let start=0,end=total-1,status=200;
        if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||!m[1]&&!m[2])return new Response(null,{status:416,headers:{'content-range':`bytes */${total}`}});
          if(!m[1]){start=Math.max(0,total-Number(m[2]));}else{start=Number(m[1]);if(m[2])end=Math.min(Number(m[2]),total-1);}
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=total||end<start)return new Response(null,{status:416,headers:{'content-range':`bytes */${total}`}});
          status=206;headers['content-range']=`bytes ${start}-${end}/${total}`;
        }
        headers['content-length']=String(end-start+1);
        if(url.searchParams.has('download'))headers['content-disposition']=`attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(record.result.candidates[0].fileName)}`;
        // Streaming avoids the buffered Lambda binary response limit for previews.
        const body=request.method==='HEAD'?null:new ReadableStream({start(controller){controller.enqueue(bytes.subarray(start,end+1));controller.close();}});
        return new Response(body,{status,headers});
      }
      const job=/^\/api\/jobs\/(xhs-[a-f\d]{32})(\/cancel)?$/.exec(path);
      if(job){const record=await ownedRecord(request,job[1]);if(!record)return json({error:'任务或会话已过期，请重新提取。'},404);
        if(job[2]&&request.method==='POST'){record.state='canceled';await storeFactory().setJSON('jobs/'+job[1],record);return json(publicJob(record));}
        if(!job[2]&&request.method==='GET')return json(publicJob(record));return json({error:'请求方法不受支持。'},405);
      }
      if(path.startsWith('/api/files/')){
        if(path.startsWith('/api/files/xhs/'))return json({error:'文件地址无效，请重新提取。'},404);
        return handleLegacyMedia(request,{transport});
      }
      if(/^\/api\/jobs\/[^/]+$/.test(path)&&request.method==='GET'){
        const response=await proxy(request);
        if(!response.ok)return response;
        const job=await response.json();
        return json(await verifyLegacyJob(job,request,{storeFactory,transport}),response.status,response.headers);
      }
      if(path==='/api/jobs'&&request.method==='POST') {
        if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return json({error:'请求需要 JSON 分享内容。'},415);
        if(Number(request.headers.get('content-length')||0)>24000)return json({error:'分享内容过长。'},413);
        const reader=request.body?.getReader();let text='',size=0;const decoder=new TextDecoder();
        if(!reader)return json({error:'分享内容为空。'},400);
        try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>24000)return json({error:'分享内容过长。'},413);text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
        let payload;try{payload=JSON.parse(text);}catch{return json({error:'分享内容格式无效。'},400);}
        const forwarded=new Request(request.url,{method:request.method,headers:request.headers,body:text});
        if(isXhsInput(payload.input)) {
          try {
            const started=Date.now(),owner=ownerOf(request)||randomBytes(32).toString('hex'),id='xhs-'+randomBytes(16).toString('hex');
            const result=await resolver(payload.input,{transport,signal:AbortSignal.timeout(45000)});
            const {bytes,candidate,...metadata}=result;
            const source=`/api/files/xhs/${id}/video.mp4`;
            const events=[
              ['input','已识别小红书分享链接并核对目标笔记。'],['browser','正在读取小红书官方移动分享页。'],
              ['session','公开分享页已返回目标视频，无需扫码登录。'],['source','已取得官方视频和笔记正文。'],
              ['transfer',`已完整接收视频文件（${bytes.byteLength} 字节）。`],['verify','文件大小、MP4 容器、视频轨道和目标时长已核验。']
            ].map(([stage,message],index)=>({id:index,time:new Date(index===0?started:Date.now()).toISOString(),stage,message}));
            const record={id,inputUrl:inputUrl(payload.input).href,platform:'xiaohongshu',state:'done',stage:'verify',events,owner,expiresAt:Date.now()+TTL,sha256:createHash('sha256').update(bytes).digest('hex'),received:bytes.byteLength,total:bytes.byteLength,result:{...metadata,candidates:[{...candidate,codec:candidate.videoCodec.toUpperCase(),videoUrl:source,downloadUrl:source+'?download=1'}]}};
            const store=storeFactory();await store.set('files/'+id,bytes,{metadata:{expiresAt:String(record.expiresAt)}});await store.setJSON('jobs/'+id,record);await store.setJSON('sessions/'+owner,{id,expiresAt:record.expiresAt});
            return json({jobId:id},202,{'set-cookie':cookie(owner)});
          } catch {
            // Preserve the existing official login flow for notes whose public
            // mobile share page genuinely requires account access.
            return proxy(forwarded);
          }
        }
        let expanded;
        try {expanded=await shortResolver(payload.input,{transport,signal:request.signal});}
        catch(error){return json({error:error.message||'抖音短链接暂时无法解析，请重新复制分享链接。'},422);}
        const owner=ownerOf(request);if(owner)await storeFactory().delete('sessions/'+owner);
        if(expanded)return proxy(new Request(request.url,{method:request.method,headers:request.headers,body:JSON.stringify({...payload,input:expanded.canonicalUrl})}));
        return proxy(forwarded);
      }
      return proxy(request);
    } catch {return json({error:'提取服务暂时无法读取，请稍后重试。'},502);}
  };
}
export default createApi();
