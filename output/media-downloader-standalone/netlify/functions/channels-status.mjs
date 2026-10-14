import {getStore} from '@netlify/blobs';
const store=()=>getStore({name:'anma-channels-jobs',consistency:'strong'});
const safeKey=value=>/^[a-f0-9]{32}$/.test(value);
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
export default async function handler(request){
  if(request.method!=='GET') return json({error:'请使用 GET 查询视频号会话。'},405);
  const jobId=new URL(request.url).searchParams.get('job')||'';
  if(!safeKey(jobId)) return json({error:'视频号会话编号无效。'},400);
  const jobs=store(),record=await jobs.get(jobId,{type:'json'});
  if(!record) return json({error:'视频号会话已过期，请重新解析。',reasonCode:'CHANNELS_JOB_NOT_FOUND'},404);
  if(Date.now()-Number(record.createdAt||0)>16*60*1000){await jobs.delete(jobId).catch(()=>{});return json({error:'视频号会话已过期，请重新解析。',reasonCode:'CHANNELS_JOB_EXPIRED'},410);}
  return json({jobId,status:record.status,stage:record.stage||'',message:record.message||'',qr:record.qr||'',result:record.status==='done'||record.status==='error'?record.result||null:null,platform:'channels',standalone:true});
}
