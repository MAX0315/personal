import { createHash } from 'node:crypto';
import { handleLegacyMedia, LEGACY_MEDIA_CHUNK_SIZE } from './legacy-media.mjs';
import { inspectMp4 } from './mp4.mjs';

const MAX_VERIFY = 32 * 1024 * 1024;
const ORIGINAL = 'https://anma-media-workbench-20261014.netlify.app';
const codecNames = {avc1:'H264',avc3:'H264',hvc1:'H265',hev1:'H265'};
const douyinVideo = candidate => candidate?.kind==='video'||candidate?.kind!=='image'&&Boolean(candidate?.videoUrl);

/** Confirm legacy video bytes before repeating the upstream verification claim. */
export async function verifyLegacyJob(job, request, {storeFactory,transport=fetch}={}) {
  const platform=job?.platform||job?.result?.platform;
  if(job?.state!=='done'||!job.result||!['channels','wechat','weixin','wechat_channels','douyin'].includes(platform))return job;
  const candidates=Array.isArray(job.result.candidates)?job.result.candidates:[];
  // Douyin photo notes already have their own extraction/validation flow.
  // Apply MP4 checks only when the result actually contains a video candidate.
  if(platform==='douyin'&&!candidates.some(douyinVideo))return job;
  const origin=new URL(request.url).origin;
  const owner=request.headers.get('cookie')||'';
  const cacheKey='legacy-verification/'+createHash('sha256').update(owner+'\n'+JSON.stringify({id:job.id,platform,candidates:job.result.candidates})).digest('hex');
  let store;try{store=storeFactory?.();}catch{}
  let cached;try{cached=await store?.get(cacheKey,{type:'json'});}catch{}
  if(cached?.expiresAt>Date.now()){
    const result={...job.result,...cached.result};
    if(result.verifiedFile)delete result.verificationError;
    return {...job,result};
  }
  const result={...job.result,verifiedFile:false,verification:'pending-media-read'};
  try {
    const videos=candidates.filter(platform==='douyin'?douyinVideo:candidate=>candidate.kind!=='image');
    if(!videos.length)throw new Error('未返回可核验的视频文件。');
    const lengths=videos.map(candidate=>Number(candidate.bytes));
    if(lengths.some(total=>!Number.isSafeInteger(total)||total<1)||lengths.reduce((sum,total)=>sum+total,0)>MAX_VERIFY)throw new Error('文件尚未完成本站完整核验，可重新提取后保存。');
    const deadline=AbortSignal.timeout(45000);
    const signal=typeof AbortSignal.any==='function'?AbortSignal.any([request.signal,deadline]):deadline;
    const verified=new Map();
    for(const candidate of videos){
      const total=Number(candidate.bytes);
      const source=new URL(candidate.videoUrl||candidate.downloadUrl,origin);
      if(![origin,ORIGINAL].includes(source.origin)||!source.pathname.startsWith('/api/files/'))throw new Error('视频文件地址无法核验。');
      const target=new URL(source.pathname+source.search,origin);
      const bytes=new Uint8Array(total);
      for(let start=0;start<total;start+=LEGACY_MEDIA_CHUNK_SIZE){
        const end=Math.min(start+LEGACY_MEDIA_CHUNK_SIZE-1,total-1);
        const response=await handleLegacyMedia(new Request(target,{headers:{cookie:owner,range:`bytes=${start}-${end}`},signal}),{transport});
        if(response.status!==206||response.headers.get('content-range')!==`bytes ${start}-${end}/${total}`)throw new Error('视频文件尚未能完整读取，请重新提取。');
        const part=new Uint8Array(await response.arrayBuffer());
        if(part.byteLength!==end-start+1)throw new Error('视频文件接收不完整，请重新提取。');
        bytes.set(part,start);
      }
      const info=inspectMp4(bytes);
      if(candidate.duration&&Math.abs(info.duration-Number(candidate.duration))>Math.max(2,info.duration*0.03))throw new Error('视频文件时长与提取结果不一致，请重新提取。');
      verified.set(candidate,{...candidate,duration:info.duration,width:info.width,height:info.height,format:'mp4',codec:codecNames[info.videoCodec]||info.videoCodec,hasAudio:info.hasAudio});
    }
    result.candidates=candidates.map(candidate=>verified.get(candidate)||candidate);
    result.verifiedFile=true;
    result.verification='full-bytes-and-mp4';
    delete result.verificationError;
  } catch(error){result.verificationError=error.message||'文件尚未能完整核验，请重新提取。';}
  try{await store?.setJSON(cacheKey,{result,expiresAt:Date.now()+(result.verifiedFile?180000:15000)});}catch{}
  return {...job,result};
}
