import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import resolve from './netlify/functions/resolve.mjs';
import { handleMedia } from './netlify/edge-functions/media.mjs';
const root=path.resolve(import.meta.dirname,'dist');
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.pdf':'application/pdf','.wasm':'application/wasm','.zip':'application/zip','.mp4':'video/mp4'};
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1:4188');
  if(url.pathname.startsWith('/api/')){
    const parts=[];for await(const part of req){parts.push(part);if(parts.reduce((n,b)=>n+b.length,0)>25000)throw Error('Request too large');}
    const body=parts.length?Buffer.concat(parts):undefined;
    const request=new Request(url,{method:req.method,headers:req.headers,...(body?{body,duplex:'half'}:{})});
    const response=url.pathname==='/api/resolve'?await resolve(request):await handleMedia(request);
    res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();return;
  }
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
}catch{res.writeHead(400);res.end('Bad request');}});
server.listen(4188,'127.0.0.1',()=>console.log('ANMA media web preview: http://127.0.0.1:4188'));
