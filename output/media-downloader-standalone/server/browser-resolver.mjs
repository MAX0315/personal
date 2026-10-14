import {lookup as dnsLookup} from 'node:dns/promises';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import E from './extractor.cjs';
import X from './xhs-extractor.cjs';
import B from './bilibili.cjs';
import {assertAllowedUrl,parseSafeUrl,platformOf,isPublicIp,safeFileName} from './policy.mjs';
import {safeFetch} from './safe-fetch.mjs';
import {resolveInput as publicResolve,extractInputUrl} from './public-resolve.mjs';

export const MAX_RESPONSE_BYTES=8*1024*1024;
export const MAX_CANDIDATES=80;
// The current site's real executions end around 30 s despite broader defaults
// documented by Netlify. Leave time for cleanup and the final JSON bytes.
const TOTAL_MS=26000;
const RESOURCE_ROOTS=[
  'douyin.com','iesdouyin.com','douyinvod.com','douyinpic.com','douyinstatic.com',
  'byteimg.com','ibytedtos.com','bytescm.com','bytecdn.cn','bytecdn.com',
  'bytedance.com','volces.com','bytednsdoc.com','bytegoofy.com','bytedance.net',
  'douyincdn.com','zjcdn.com','bilibili.com','bilivideo.com','bilivideo.cn',
  'hdslb.com','biliimg.com','bilicdn1.com','bilicdn2.com','biliapi.net','biliapi.com','b23.tv','bili2233.cn',
  'xiaohongshu.com','xhslink.com','xhslink.cn','xhscdn.com','xhscdn.net','redcdn.net'
];
function timeout(promise,milliseconds,message='读取平台超时。') {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]).finally(()=>clearTimeout(timer));
}
export function supportedBrowserRoute(value,platform=platformOf(value)) {
  const url=assertAllowedUrl(value,'page');
  if(url.protocol!=='https:') url.protocol='https:';
  let supported=false;
  if(platform==='douyin') supported=url.hostname==='v.douyin.com' && /^\/[A-Za-z\d]{5,30}\/?$/.test(url.pathname) || !!E.getDouyinId(url.href);
  if(platform==='xiaohongshu') supported=!!X.getNoteId(url.href) || ['xhslink.com','www.xhslink.com','xhslink.cn','www.xhslink.cn'].includes(url.hostname) && /^\/(?:[A-Za-z\d]+\/)*[A-Za-z\d]+\/?$/.test(url.pathname);
  if(platform==='bilibili') supported=!!B.getBvid(url.href) || !!B.getAid(url.href) || ['b23.tv','www.b23.tv','bili2233.cn','www.bili2233.cn'].includes(url.hostname) && /^\/[A-Za-z\d]+\/?$/.test(url.pathname);
  if(!supported) throw new Error('请使用具体作品的分享链接，主页、直播间或搜索页面不能作为完整视频解析。');
  return url;
}
export async function validateResourceUrl(value,{lookupFn=dnsLookup,dnsCache=new Map()}={}) {
  if(value==='about:blank' || /^data:|^blob:/i.test(value)) return true;
  const url=parseSafeUrl(value);
  if(url.protocol!=='https:' || !RESOURCE_ROOTS.some(root=>url.hostname===root || url.hostname.endsWith('.'+root))) throw new Error('资源域名不受支持。');
  if(!dnsCache.has(url.hostname)) {
    const check=timeout(lookupFn(url.hostname,{all:true,verbatim:true}),3000).then(addresses=>{
      if(!addresses.length || addresses.some(item=>!isPublicIp(item.address))) throw new Error('资源域名指向非公开网络。');
      return true;
    });
    dnsCache.set(url.hostname,check);
  }
  return await dnsCache.get(url.hostname);
}
export function cleanBrowserCandidates(items,targetId,platform) {
  return E.rankCandidates(items).filter(item=>item && String(item.videoId||item.noteId||'')===String(targetId) && !item.encrypted && !item.decodeKey && !/dash|hls|mpegurl|segment|audio/i.test(item.kind||'')).slice(0,MAX_CANDIDATES).flatMap(item=>{
    try {
      const videoUrl=assertAllowedUrl(item.videoUrl||item.imageUrl,'media').href;
      const kind=item.kind==='image'?'image':'video';
      const extension=String(item.fileName||new URL(videoUrl).pathname).match(/\.(mp4|webm|mov|m4v|jpe?g|png|webp|gif|avif|heic|heif)$/i)?.[1]?.toLowerCase() || (kind==='image'?'jpg':'mp4');
      const backupUrls=(Array.isArray(item.backupUrls)?item.backupUrls:[]).slice(0,8).flatMap(value=>{try{return [assertAllowedUrl(value,'media').href];}catch{return [];}});
      return [{...item,videoUrl,backupUrls,kind,platform,videoId:String(targetId),fileName:safeFileName(item.fileName||item.title||'media',extension==='jpeg'?'jpg':extension)}];
    }catch{return [];}
  });
}
function targetIdFor(url,platform) {return platform==='douyin'?E.getDouyinId(url):platform==='xiaohongshu'?X.getNoteId(url):B.getBvid(url)||B.getAid(url);}
function unsupported(platform,pageUrl,videoId='',reasonCode='PLATFORM_RESTRICTED') {
  const name={douyin:'抖音',xiaohongshu:'小红书',bilibili:'B 站',channels:'视频号'}[platform]||'平台';
  const error=reasonCode==='RESOLVE_TIMEOUT'?'解析等待超时，请稍后重新尝试。':reasonCode==='REQUEST_CANCELLED'?'解析已取消。':reasonCode==='PLATFORM_UNAVAILABLE'?`${name}页面暂时无法读取，请稍后重试。`:reasonCode==='TARGET_MISMATCH'?'目标作品核对不一致，已停止解析，请核对分享链接后重试。':`${name}公开页面未提供这条作品可保存的完整媒体。作品要求登录、验证码、会员或账号权限时，当前纯网页版无法代用平台登录。`;
  return {error,reasonCode,platform,pageUrl,videoId,standalone:true,needsBridge:false,requiresPage:false};
}
async function readResponse(response) {
  const length=Number(response.headers()['content-length']||0);
  if(length>MAX_RESPONSE_BYTES) return '';
  const text=await response.text();
  return Buffer.byteLength(text)<=MAX_RESPONSE_BYTES?text:'';
}
async function publicBiliInPage(page,value,deadline) {
  const url=assertAllowedUrl(value,'api');
  return await timeout(page.evaluate(async ({url,maximum,timeoutMs})=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    let reader;
    try {
      const response=await fetch(url,{credentials:'omit',signal:controller.signal});
      if(!response.ok || Number(response.headers.get('content-length')||0)>maximum) return {status:response.status,text:''};
      reader=response.body?.getReader();if(!reader)return {status:response.status,text:''};
      const decoder=new TextDecoder();let bytes=0,text='';
      while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>maximum)return {status:response.status,text:''};text+=decoder.decode(item.value,{stream:true});}
      return {status:response.status,text:text+decoder.decode()};
    }catch{return {status:0,text:''};}
    finally{clearTimeout(timer);try{await reader?.cancel();}catch{}}
  },{url:url.href,maximum:MAX_RESPONSE_BYTES,timeoutMs:Math.min(4500,Math.max(500,deadline-Date.now()-2500))}),Math.min(5000,Math.max(500,deadline-Date.now()-2000))).catch(()=>({status:0,text:''}));
}
export function biliInfoFromView(payload,targetId,pageUrl) {
  const data=payload?.code===0?payload.data:null;
  if(!data || /^BV/i.test(targetId) && String(data.bvid)!==targetId || !/^BV/i.test(targetId) && String(data.aid)!==targetId) return null;
  const requestedPage=B.getPage(pageUrl);
  const selected=data.pages?.find(item=>Number(item.page)===requestedPage)||(requestedPage===1?data.pages?.[0]:null);
  if(requestedPage>1 && !selected) return {unavailablePage:true,page:requestedPage,candidates:[]};
  const info={bvid:data.bvid||'',aid:String(data.aid||''),cid:String(selected?.cid||data.cid||''),page:requestedPage,title:String(data.title||'哔哩哔哩视频'),duration:Number(selected?.duration||data.duration)||0};
  return info.cid?info:null;
}
async function progressiveBiliInPage(page,targetId,pageUrl,deadline,capturedInfo,nativeResponses) {
  if(targetIdFor(page.url(),'bilibili')!==targetId || Date.now()>deadline-3500) return null;
  let info=capturedInfo;
  if(!info) {
    const view=new URL('https://api.bilibili.com/x/web-interface/view');
    view.searchParams.set(/^BV/i.test(targetId)?'bvid':'aid',targetId);
    const response=await publicBiliInPage(page,view.href,deadline),metadata=B.parseJson(response.text);
    nativeResponses.push({host:view.hostname,path:view.pathname,status:response.status,code:metadata?.code??null,phase:'public-view'});
    info=biliInfoFromView(metadata,targetId,pageUrl);
  }
  if(!info || info.unavailablePage) return info;
  const candidates=[];
  for(const quality of [80]) {
    if(candidates.length || Date.now()>deadline-3500 || targetIdFor(page.url(),'bilibili')!==targetId) break;
    const playUrl=B.buildPlayUrl(info,quality),response=await publicBiliInPage(page,playUrl,deadline),payload=B.parseJson(response.text);
    nativeResponses.push({host:'api.bilibili.com',path:'/x/player/playurl',status:response.status,code:payload?.code??null,phase:'public-progressive',cid:info.cid});
    if(payload?.code===0) candidates.push(...B.candidatesFromApi(payload,info).map(item=>({...item,videoId:targetId})));
  }
  return {...info,candidates};
}
export async function resolveWithBrowser(pageUrl,{deadline=Date.now()+TOTAL_MS,platform=platformOf(pageUrl),signal}={}) {
  const requested=supportedBrowserRoute(pageUrl,platform);
  let targetId=targetIdFor(requested.href,platform),browser,timer,stopped=false;
  const started=Date.now(),dnsCache=new Map(),pending=new Set();
  let candidates=[],pageTitle='',biliInfo=null,navigationStatus=0;
  const nativeResponses=[];
  const phases=[];
  const resolution=()=>({runtime:process.platform+'-chromium',elapsedMs:Date.now()-started,phases,nativeResponses:nativeResponses.slice(0,12)});
  const failure=(url=requested.href,id=targetId,code='PLATFORM_RESTRICTED')=>({...unsupported(platform,url,id,code),resolution:resolution()});
  const onAbort=()=>{stopped=true;void browser?.close().catch(()=>{});};
  signal?.addEventListener('abort',onAbort,{once:true});
  try {
    if(signal?.aborted) return failure(requested.href,targetId,'REQUEST_CANCELLED');
    await validateResourceUrl(requested.href,{dnsCache});
    phases.push({name:'dns',elapsedMs:Date.now()-started});
    chromium.setGraphicsMode=false;
    const executablePath=await timeout(chromium.executablePath(),Math.min(12000,deadline-Date.now()));
    if(signal?.aborted) return failure(requested.href,targetId,'REQUEST_CANCELLED');
    const args=chromium.args.filter(arg=>!/^--(?:disable-web-security|allow-running-insecure-content)(?:=|$)/.test(arg));
    browser=await puppeteer.launch({args,executablePath,headless:'shell',defaultViewport:{width:1280,height:900},timeout:Math.min(12000,Math.max(1000,deadline-Date.now()))});
    if(signal?.aborted) return failure(requested.href,targetId,'REQUEST_CANCELLED');
    phases.push({name:'browser-ready',elapsedMs:Date.now()-started});
    timer=setTimeout(()=>{stopped=true;void browser.close().catch(()=>{});},Math.max(1,deadline-Date.now()-1800));
    const page=await browser.newPage();
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request',request=>{
      void (async()=>{
        try {
          await validateResourceUrl(request.url(),{dnsCache});
          if(['image','font','media'].includes(request.resourceType())) await request.abort();
          else await request.continue();
        }catch{try{await request.abort();}catch{}}
      })();
    });
    page.on('response',response=>{
      const task=(async()=>{
        try {
          const url=new URL(response.url());
          const currentId=targetIdFor(page.url(),platform);
          targetId=targetId||currentId;
          if(!targetId || currentId!==targetId) return;
          if(response.status()!==200) {
            if(platform==='bilibili' && url.hostname==='api.bilibili.com' && /^\/x\/(?:web-interface\/(?:wbi\/)?view|player\/(?:wbi\/)?playurl)$/.test(url.pathname) && (url.searchParams.get('bvid')===targetId || url.searchParams.get('aid')===targetId || biliInfo?.cid && url.searchParams.get('cid')===biliInfo.cid)) nativeResponses.push({host:url.hostname,path:url.pathname,status:response.status(),phase:'native-http-error'});
            return;
          }
          if(platform==='bilibili' && url.hostname==='api.bilibili.com' && /^\/x\/web-interface\/(?:wbi\/)?view$/.test(url.pathname) && (url.searchParams.get('bvid')===targetId || url.searchParams.get('aid')===targetId)) {
            const payload=B.parseJson(await readResponse(response)),info=biliInfoFromView(payload,targetId,page.url());
            if(info) biliInfo=info;
            nativeResponses.push({host:url.hostname,path:url.pathname,status:response.status(),code:payload?.code??null,phase:'native-view',cid:info?.cid||''});
          }
          if(platform==='douyin' && ['www.douyin.com','www-hj.douyin.com'].includes(url.hostname) && /\/aweme\/v\d+\/(?:web\/)?aweme\/detail\//.test(url.pathname) && url.searchParams.get('aweme_id')===targetId) {
            const text=await readResponse(response),found=E.extractDouyin(E.parseJson(text),targetId);
            candidates=E.rankCandidates([...candidates,...found]);
            nativeResponses.push({host:url.hostname,path:url.pathname,status:response.status(),matchedId:targetId,candidates:found.length});
          }
          if(platform==='xiaohongshu' && ['edith.xiaohongshu.com','www.xiaohongshu.com'].includes(url.hostname) && /\/api\/(?:sns\/web\/)?v\d+\/(?:feed|note\/detail)/.test(url.pathname)) {
            const text=await readResponse(response),found=X.extractFromState(X.parseState(text),targetId);
            candidates=E.rankCandidates([...candidates,...found]);
          }
          if(platform==='bilibili' && url.hostname==='api.bilibili.com' && biliInfo && /^\/x\/player\/(?:wbi\/)?playurl$/.test(url.pathname) && url.searchParams.get('cid')===biliInfo.cid && ((url.searchParams.get('bvid')||'').toLowerCase()===String(biliInfo.bvid||'').toLowerCase() || url.searchParams.get('avid')===biliInfo.aid)) {
            const text=await readResponse(response),payload=B.parseJson(text);
            if(payload?.code===0) candidates=E.rankCandidates([...candidates,...B.candidatesFromApi(payload,biliInfo)]);
          }
        }catch{}
      })();
      pending.add(task);void task.finally(()=>pending.delete(task));
    });
    let readyInterval;
    const navigation=page.goto(requested.href,{waitUntil:'domcontentloaded',timeout:Math.min(10000,Math.max(1000,deadline-Date.now()-3500))}).then(response=>{navigationStatus=response?.status()||0;phases.push({name:'navigation',elapsedMs:Date.now()-started,status:navigationStatus});}).catch(()=>{phases.push({name:'navigation-ended',elapsedMs:Date.now()-started});});
    const targetReady=new Promise(resolve=>{readyInterval=setInterval(()=>{if(stopped || cleanBrowserCandidates(candidates,targetId,platform).length || platform==='bilibili' && biliInfo)resolve();},150);});
    try{await Promise.race([navigation,targetReady]);}finally{clearInterval(readyInterval);}
    targetId=targetId||targetIdFor(page.url(),platform);
    phases.push({name:'target-context',elapsedMs:Date.now()-started});
    if(platform==='bilibili' && [401,403,412].includes(navigationStatus)) return {...failure(page.url(),targetId,'PLATFORM_RESTRICTED'),httpStatus:navigationStatus,error:'B 站限制了云端网页访问，当前无法取得可保存的媒体。请稍后重试或更换公开作品链接。'};
    if(platform==='bilibili' && targetId) {
      const info=await progressiveBiliInPage(page,targetId,page.url(),deadline,biliInfo,nativeResponses);
      if(info?.unavailablePage) return {...failure(page.url(),targetId,'PAGE_NOT_FOUND'),error:`这条 B 站作品没有第 ${info.page} 个分 P，请核对链接中的 p 参数。`};
      if(info) {biliInfo=info;candidates=E.rankCandidates([...candidates,...info.candidates]);}
    }
    const captureUntil=Math.min(deadline-3000,Date.now()+12000);
    while(Date.now()<captureUntil && !stopped) {
      const currentId=targetIdFor(page.url(),platform);
      if(targetId && currentId!==targetId) return failure(requested.href,targetId,'TARGET_MISMATCH');
      let html=await page.content().catch(()=>'');
      if(Buffer.byteLength(html)>MAX_RESPONSE_BYTES) html='';
      if(platform==='douyin') candidates=E.rankCandidates([...candidates,...E.extractFromHtml(html,targetId)]);
      if(platform==='xiaohongshu') {
        const result=X.extractFromHtml(html,page.url());
        if(result.noteId===targetId) candidates=E.rankCandidates([...candidates,...result.candidates]);
      }
      // Bili candidates are accepted only from the verified view/cid binding and
      // matching player response. Generic page state can contain related works.
      if(cleanBrowserCandidates(candidates,targetId,platform).length) break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(pending.size) await timeout(Promise.allSettled([...pending]),Math.min(2000,Math.max(1,deadline-Date.now()-2000))).catch(()=>{});
    const finalUrl=page.url();
    if(targetIdFor(finalUrl,platform)!==targetId) return failure(requested.href,targetId,'TARGET_MISMATCH');
    supportedBrowserRoute(finalUrl,platform);
    const clean=cleanBrowserCandidates(candidates,targetId,platform);
    if(!clean.length) return failure(finalUrl,targetId,Date.now()>deadline-3500?'RESOLVE_TIMEOUT':'PLATFORM_RESTRICTED');
    pageTitle=clean[0]?.title||await page.title().catch(()=>'');
    return {platform,pageUrl:finalUrl,videoId:targetId,title:pageTitle,candidates:clean,matched:true,clientPreview:true,verifiedMedia:false,method:'cloud-browser',standalone:true,resolution:{...resolution(),targetVerified:true,...(biliInfo?{bilibili:{bvid:biliInfo.bvid,aid:biliInfo.aid,cid:biliInfo.cid,page:biliInfo.page}}:{})}};
  }catch {
    return failure(requested.href,targetId,stopped||Date.now()>=deadline-2000?'RESOLVE_TIMEOUT':'PLATFORM_UNAVAILABLE');
  }finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort',onAbort);
    if(browser) await timeout(browser.close().catch(()=>{}),1200).catch(()=>{try{browser.process()?.kill('SIGKILL');}catch{}});
  }
}
export async function resolveStandalone(payload,{signal}={}) {
  const started=Date.now(),pageUrl=extractInputUrl(payload?.pageUrl),platform=platformOf(pageUrl);
  if(signal?.aborted) return unsupported(platform,pageUrl,'','REQUEST_CANCELLED');
  if(platform==='channels') return unsupported(platform,pageUrl,'','UNSUPPORTED_PLATFORM');
  if(['douyin','bilibili'].includes(platform)) return resolveWithBrowser(pageUrl,{platform,deadline:started+TOTAL_MS,signal});
  // Reject unsupported inputs before fallback; transient public HTTP failures can
  // still use a fresh, ordinary browser on the approved target work page.
  try{assertAllowedUrl(pageUrl,'media');}catch{assertAllowedUrl(pageUrl,'page');}
  const publicController=new AbortController();
  const abortPublic=()=>publicController.abort();
  signal?.addEventListener('abort',abortPublic,{once:true});
  const publicTimer=setTimeout(()=>publicController.abort(),8000);
  let publicResult;
  try {
    const transport=(value,options={})=>safeFetch(value,{...options,signal:options.signal?AbortSignal.any([options.signal,publicController.signal]):publicController.signal});
    publicResult=await timeout(publicResolve({pageUrl},{transport}),8200).catch(()=>({candidates:[]}));
  }finally{clearTimeout(publicTimer);publicController.abort();signal?.removeEventListener('abort',abortPublic);}
  if(signal?.aborted) return unsupported(platform,pageUrl,'','REQUEST_CANCELLED');
  if(publicResult.invalidPage) return {...publicResult,standalone:true,needsBridge:false,requiresPage:false};
  if(publicResult.candidates?.length) return {...publicResult,method:publicResult.method||'public-page',standalone:true,clientPreview:true,needsBridge:false};
  if(['bilibili','xiaohongshu'].includes(platform) && Date.now()-started<35000) return resolveWithBrowser(pageUrl,{platform,deadline:started+TOTAL_MS,signal});
  return unsupported(platform,pageUrl,publicResult.videoId||'',publicResult.reasonCode||'PLATFORM_RESTRICTED');
}
