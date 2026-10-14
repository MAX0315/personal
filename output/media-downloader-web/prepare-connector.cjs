const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=__dirname;
const ext=path.join(root,'chrome-extension');
const manifestPath=path.join(ext,'manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(!manifest.key){
  const {publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  manifest.key=publicKey.export({type:'spki',format:'der'}).toString('base64');
}
const version='1.8.2';
manifest.version=version;
manifest.action.default_title='黯马AIGC · 原媒体下载助手 v'+version;
manifest.externally_connectable={matches:['https://anma-media-tool-20261012.netlify.app/*']};
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
const hash=crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32);
const id=[...hash].map(ch=>'abcdefghijklmnop'[parseInt(ch,16)]).join('');
fs.writeFileSync(path.join(root,'dist','config.js'),`window.ANMA_EXTENSION_ID=${JSON.stringify(id)};\n`);
for(const name of ['popup.html','channels-hook.js','tests/channels-hook.test.cjs','tests/background-channels.test.cjs']){
  const p=path.join(ext,name);if(fs.existsSync(p))fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/1\.8\.[01]/g,version));
}
const bgpath=path.join(ext,'background.js');
let background=fs.readFileSync(bgpath,'utf8');
if(!background.includes("importScripts('web-bridge.js')"))background+="\nimportScripts('web-bridge.js');\n";
fs.writeFileSync(bgpath,background);
console.log(JSON.stringify({extensionId:id,version:manifest.version,allowedOrigin:'https://anma-media-tool-20261012.netlify.app'}));
