import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const endpoint='https://6accf12f19a40a5fbd15b1b6--anma-media-tool-20261012.netlify.app/.netlify/functions/probe';
const cases=[['screenshot','https://v.douyin.com/Z0wh2LKx4MI/'],['independent','https://www.douyin.com/video/7676489080318171889']];
for(const [name,pageUrl] of cases){
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageUrl}),signal:AbortSignal.timeout(58000)});
  const result=await response.json();
  const report={name,checkedAt:new Date().toISOString(),resolver:'Real Netlify Linux Chromium public session',targetId:result.targetId,candidateCount:result.candidates?.length||0,tests:[],fullDownload:null};
  for(const c of (result.candidates||[]).filter(c=>c.codec==='h264' && !/douyin.com$/.test(new URL(c.videoUrl).hostname)).slice(0,10)){
    const item={host:new URL(c.videoUrl).hostname,codec:c.codec,duration:c.duration,width:c.width,height:c.height};
    try{
      const r=await fetch(c.videoUrl,{headers:{range:'bytes=0-65535',referer:'https://www.douyin.com/'},signal:AbortSignal.timeout(16000)});
      const b=Buffer.from(await r.arrayBuffer()); item.status=r.status;item.type=r.headers.get('content-type');item.bytes=b.length;item.range=r.headers.get('content-range');item.ftyp=b.subarray(4,8).toString()==='ftyp';
      report.tests.push(item);
      if(item.ftyp && r.ok){
        const full=await fetch(c.videoUrl,{headers:{referer:'https://www.douyin.com/'},signal:AbortSignal.timeout(25000)});
        const bytes=Buffer.from(await full.arrayBuffer());
        const f=new URL('./'+name+'-cloud-extracted.mp4',import.meta.url);
        const check={status:full.status,type:full.headers.get('content-type'),bytes:bytes.length,declared:full.headers.get('content-length')};
        if(full.ok && bytes.subarray(4,8).toString()==='ftyp'){
          await fs.writeFile(f,bytes);
          const pathname=decodeURIComponent(f.pathname).replace(/^\//,'');
          const probe=spawnSync('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height','-of','json',pathname],{encoding:'utf8'});
          const decode=spawnSync('ffmpeg',['-v','error','-i',pathname,'-f','null','-'],{encoding:'utf8',timeout:30000});
          check.ffprobe=probe.status===0?JSON.parse(probe.stdout):{exitCode:probe.status,error:probe.stderr.slice(0,300)};check.fullDecode={exitCode:decode.status,error:decode.stderr.slice(0,300)};check.complete=probe.status===0 && decode.status===0;
        }
        report.fullDownload=check; if(check.complete)break;
      }
    }catch(error){item.error=error.name;report.tests.push(item);}
  }
  await fs.writeFile(new URL('./'+name+'-cdn-report.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
