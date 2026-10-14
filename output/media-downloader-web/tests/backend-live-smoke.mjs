// Optional real-media smoke: node tests/backend-live-smoke.mjs [deployed-site-url]
// The CC0 example proves our own parsing / streaming path; it does not prove platform login access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveInput } from '../server/resolve.mjs';
import { handleMedia } from '../netlify/edge-functions/media.mjs';

const source = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const site = process.argv[2]?.replace(/\/$/,'');
const outputDir = new URL('./artifacts/',import.meta.url);
await fs.mkdir(outputDir,{ recursive:true });
const result = site ? await (await fetch(site + '/api/resolve',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ pageUrl:source }) })).json() : await resolveInput({ pageUrl:source });
assert.equal(result.candidates?.[0]?.videoUrl,source);
const mediaUrl = (site || 'https://local.example') + '/api/media?url=' + encodeURIComponent(source) + '&download=1&filename=CC0示例.mp4';
const media = site ? await fetch(mediaUrl) : await handleMedia(new Request(mediaUrl));
assert.equal(media.status,200,await (media.status !== 200 ? media.text() : Promise.resolve('')));
assert.equal(media.headers.get('content-type'),'video/mp4');
assert.match(media.headers.get('content-disposition'),/attachment/);
const file = new URL(site ? './artifacts/deployed-cc0-sample.mp4' : './artifacts/local-cc0-sample.mp4',import.meta.url);
await pipeline(Readable.fromWeb(media.body),createWriteStream(file));
const stat = await fs.stat(file);
const declaredLength = Number(media.headers.get('content-length'));
if (declaredLength > 0) assert.equal(stat.size,declaredLength);
// Netlify streams can omit Content-Length. This fixed CC0 fixture has a known full size.
assert.equal(stat.size,1128375);
const probe = spawnSync('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height','-of','json',fileURLToPath(file)],{ encoding:'utf8',windowsHide:true });
assert.equal(probe.status,0,probe.stderr || probe.error?.message);
const info = JSON.parse(probe.stdout);
assert(info.streams.some(stream => stream.codec_type === 'video'));
assert(Number(info.format.duration) > 1);
const decode = spawnSync('ffmpeg',['-v','error','-i',fileURLToPath(file),'-f','null','-'],{ encoding:'utf8',windowsHide:true });
assert.equal(decode.status,0,decode.stderr || decode.error?.message);
const rangeUrl = mediaUrl.replace('download=1','download=0');
const partial = site ? await fetch(rangeUrl,{ headers:{ Range:'bytes=0-255' } }) : await handleMedia(new Request(rangeUrl,{ headers:{ Range:'bytes=0-255' } }));
assert.equal(partial.status,206); assert.equal((await partial.arrayBuffer()).byteLength,256);
const report = { at:new Date().toISOString(),site:site || 'local module',source,downloadBytes:stat.size,mediaType:media.headers.get('content-type'),duration:Number(info.format.duration),streams:info.streams,fullDecode:'passed',rangePreview:'passed',scope:'Public CC0 fixture; platform real-media sessions remain separate validation.' };
await fs.writeFile(new URL(site ? './artifacts/deployed-smoke.json' : './artifacts/local-smoke.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
