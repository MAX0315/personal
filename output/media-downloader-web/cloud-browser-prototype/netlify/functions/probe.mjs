import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import E from '../../extractor.cjs';

export const config = {};
const headers = { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' };
const roots = ['douyin.com','iesdouyin.com','douyinvod.com','douyinpic.com','douyinstatic.com','byteimg.com','ibytedtos.com','bytescm.com','bytecdn.cn','bytedance.com','volces.com','bilibili.com','bilivideo.com','hdslb.com','biliimg.com','bilicdn1.com','bilicdn2.com','biliapi.net','biliapi.com','bytednsdoc.com','bytegoofy.com','bytedance.net','douyincdn.com'];
function json(data, status = 200) { return new Response(JSON.stringify(data), {status,headers}); }
function allowedResource(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && roots.some(root => u.hostname === root || u.hostname.endsWith('.'+root)); } catch { return false; }
}
function target(value) {
  const u = new URL(value);
  if (!allowedResource(u.href)) throw new Error('Only approved public platform pages are supported');
  if (u.hostname === 'v.douyin.com' && /^\/[A-Za-z0-9]{5,20}\/$/.test(u.pathname)) return {url:u.href,platform:'douyin',id:''};
  if (/^(?:www\.)?(?:ies)?douyin\.com$/.test(u.hostname)) {
    const id = E.getDouyinId(u.href); if(id) return {url:u.href,platform:'douyin',id};
  }
  if (u.hostname === 'www.bilibili.com' && /^\/video\/BV[A-Za-z0-9]+\/?$/.test(u.pathname)) return {url:u.href,platform:'bilibili',id:u.pathname.match(/BV[A-Za-z0-9]+/)[0]};
  throw new Error('Unsupported public page route');
}
export default async function probe(request) {
  if(request.method !== 'POST') return json({error:'POST required'},405);
  if(Number(request.headers.get('content-length')||0)>24000) return json({error:'Body too large'},413);
  const start=Date.now(); let browser, timer, stopped=false;
  const evidence={checkedAt:new Date().toISOString(),runtime:process.version,platform:process.platform,mocksUsed:false,cookiesImported:false,detailResponses:[],blockedHosts:[]};
  try {
    const text=await request.text(); if(Buffer.byteLength(text)>24000) return json({error:'Body too large'},413);
    const input=JSON.parse(text); if(!input || Object.keys(input).some(key=>key!=='pageUrl')) return json({error:'pageUrl only'},400);
    const requested=target(input.pageUrl); evidence.input= requested.url; evidence.targetId=requested.id;
    chromium.setGraphicsMode=false;
    const executablePath=await chromium.executablePath(); evidence.extractMs=Date.now()-start;
    const args=chromium.args.filter(arg=>!/^--(?:disable-web-security|allow-running-insecure-content)(?:=|$)/.test(arg));
    browser=await puppeteer.launch({args,executablePath,headless:'shell',defaultViewport:{width:1280,height:900},timeout:12000});
    evidence.launchMs=Date.now()-start;
    timer=setTimeout(()=>{stopped=true; void browser?.close().catch(()=>{});}, Math.max(1,45000-(Date.now()-start)));
    const page=await browser.newPage();
    await page.setRequestInterception(true);
    const blocked=new Set();
    page.on('request', req=>{
      const url=req.url();
      if(url==='about:blank' || url.startsWith('data:') || url.startsWith('blob:') || allowedResource(url)) void req.continue().catch(()=>{});
      else { try{blocked.add(new URL(url).hostname);}catch{} void req.abort().catch(()=>{}); }
    });
    let id=requested.id, candidates=[], pending=[];
    page.on('response', response=>{
      const operation=(async()=>{
        try {
          const u=new URL(response.url());
          if(requested.platform!=='douyin' || !/\/aweme\/v\d+\/(?:web\/)?aweme\/detail\//.test(u.pathname)) return;
          const responseId=u.searchParams.get('aweme_id')||'';
          id=id||E.getDouyinId(page.url());
          if(!id || responseId!==id) return;
          const raw=await response.text();
          const found=E.extractDouyin(E.parseJson(raw),id);
          evidence.detailResponses.push({host:u.hostname,path:u.pathname,status:response.status(),targetId:responseId,bytes:Buffer.byteLength(raw),candidateCount:found.length});
          candidates=E.rankCandidates([...candidates,...found]);
        } catch {}
      })();
      pending.push(operation);
    });
    try{await page.goto(requested.url,{waitUntil:'domcontentloaded',timeout:20000});}catch(error){evidence.navigationError=String(error.message).split('\n')[0].replace(/https?:\/\/\S+/g,'[page]');}
    if(requested.platform==='douyin') id=id||E.getDouyinId(page.url());
    evidence.targetId=id;
    const until=Math.min(start+42000,Date.now()+25000);
    while(Date.now()<until && !stopped && candidates.length===0) {
      if(requested.platform==='douyin') {
        const html=await page.content().catch(()=>'');
        candidates=E.rankCandidates([...candidates,...E.extractFromHtml(html,id)]);
      }
      if(!candidates.length) await new Promise(resolve=>setTimeout(resolve,750));
    }
    await Promise.allSettled(pending);
    evidence.finalUrl=page.url(); evidence.title=await page.title().catch(()=>'');
    evidence.pageSummary=await page.evaluate(()=>({text:document.body.innerText.slice(0,1600),videos:[...document.querySelectorAll('video')].map(v=>({width:v.videoWidth,height:v.videoHeight,duration:Number.isFinite(v.duration)?v.duration:null,readyState:v.readyState,currentSrcPresent:!!v.currentSrc,error:v.error?.message||''}))})).catch(()=>({}));
    evidence.blockedHosts=[...blocked];
    evidence.candidateCount=candidates.length;
    evidence.candidateSummary=candidates.slice(0,4).map(c=>({videoId:c.videoId,title:c.title,duration:c.duration,width:c.width,height:c.height,codec:c.codec,source:c.source,mediaHost:new URL(c.videoUrl).hostname}));
    evidence.elapsedMs=Date.now()-start;
    evidence.rssBytes=process.memoryUsage().rss;
    return json({...evidence,candidates});
  } catch(error) {
    return json({...evidence,error:String(error.message).replace(/https?:\/\/\S+/g,'[page]'),elapsedMs:Date.now()-start},500);
  } finally {
    clearTimeout(timer); if(browser) await browser.close().catch(()=>{});
  }
}
