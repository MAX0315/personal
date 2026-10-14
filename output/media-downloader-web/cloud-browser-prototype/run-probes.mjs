import fs from 'node:fs/promises';
const site='https://6accf12f19a40a5fbd15b1b6--anma-media-tool-20261012.netlify.app';
const tests=[
  ['douyin-screenshot-cold','https://v.douyin.com/Z0wh2LKx4MI/'],
  ['douyin-screenshot-warm','https://v.douyin.com/Z0wh2LKx4MI/'],
  ['douyin-independent','https://www.douyin.com/video/7676489080318171889']
];
for(const [name,pageUrl] of tests) {
  const started=Date.now(); let body;
  try {
    const r=await fetch(site+'/.netlify/functions/probe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageUrl}),signal:AbortSignal.timeout(58000)});
    const text=await r.text();
    try{body=JSON.parse(text);}catch{body={error:text.slice(0,500)};}
    const candidates=body.candidates||[]; delete body.candidates;
    const report={...body,name,httpStatus:r.status,requestMs:Date.now()-started};
    if(candidates.length) {
      const c=candidates.find(v=>v.kind==='video' && v.codec==='h264')||candidates[0];
      const media=new URL('https://anma-media-tool-20261012.netlify.app/api/media');
      media.search=new URLSearchParams({url:c.videoUrl,kind:c.kind==='image'?'image':'video',filename:c.fileName,download:'0'}).toString();
      try{
        const preview=await fetch(media,{headers:{range:'bytes=0-65535'},signal:AbortSignal.timeout(18000)});
        const buf=Buffer.from(await preview.arrayBuffer());
        report.mediaPreview={status:preview.status,contentType:preview.headers.get('content-type'),bytes:buf.length,header:buf.subarray(0,16).toString('hex')};
      }catch(error){report.mediaPreview={error:error.name};}
    }
    await fs.writeFile(new URL('./'+name+'.json',import.meta.url),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }catch(error) { console.log(JSON.stringify({name,error:error.message,requestMs:Date.now()-started})); }
}
