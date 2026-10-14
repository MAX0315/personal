import {getStore} from '@netlify/blobs';
import {resolveChannelsWithBrowser} from '../../server/channels-browser.mjs';

export const config={background:true};
const MAX_RUNTIME=14*60*1000;
const store=()=>getStore({name:'anma-channels-jobs',consistency:'strong'});
const safeKey=value=>/^[a-f0-9]{32}$/.test(value);

export default async function handler(request){
  const jobId=new URL(request.url).searchParams.get('job')||'';
  if(request.method!=='POST'||!safeKey(jobId)) return new Response('invalid job',{status:400});
  const jobs=store(),record=await jobs.get(jobId,{type:'json'});
  if(!record) return new Response('job not found',{status:404});
  if(['running','done','error'].includes(record.status)) return new Response('already started',{status:202});
  const started=Date.now();
  await jobs.setJSON(jobId,{...record,status:'running',updatedAt:started,stage:'browser'});
  const saveEvent=async event=>{
    const current=await jobs.get(jobId,{type:'json'}).catch(()=>null);
    if(!current||current.status==='done'||current.status==='error') return;
    const patch={...current,updatedAt:Date.now(),stage:event.type||'working'};
    if(event.type==='qr') Object.assign(patch,{qr:event.image||'',message:event.message||'请使用微信扫码登录。'});
    else if(event.message) patch.message=event.message;
    await jobs.setJSON(jobId,patch);
  };
  try{
    const result=await resolveChannelsWithBrowser(record.pageUrl,{deadline:started+MAX_RUNTIME,loginWaitMs:10*60*1000,onEvent:saveEvent});
    const status=result?.candidates?.length?'done':'error';
    await jobs.setJSON(jobId,{...record,status,updatedAt:Date.now(),stage:status,message:result?.error||'解析完成',result,qr:status==='done'?'':''});
    return new Response('ok',{status:202});
  }catch(error){
    const result={error:error?.message||'视频号后台解析失败，请重试。',reasonCode:'CHANNELS_JOB_FAILED',platform:'channels',standalone:true,candidates:[]};
    await jobs.setJSON(jobId,{...record,status:'error',updatedAt:Date.now(),stage:'error',message:result.error,result,qr:''});
    return new Response('failed',{status:202});
  }
}
