export async function forwardBackground(request) {
  const incoming=new URL(request.url);
  if(!['/.netlify/functions/extract-background','/.netlify/functions/platform-background'].includes(incoming.pathname))return new Response(null,{status:404});
  const target=new URL(incoming.pathname+incoming.search,'https://anma-media-workbench-20261014.netlify.app');
  const headers=new Headers();
  const cookie=(request.headers.get('cookie')||'').split(';').filter(part=>!part.trim().startsWith('anma_xhs_session=')).join(';');
  if(cookie)headers.set('cookie',cookie);
  const response=await fetch(target,{method:'POST',headers,signal:AbortSignal.timeout(25000)});
  await response.body?.cancel();
  if(!response.ok)throw new Error('原有平台提取服务暂时无法启动。');
}
