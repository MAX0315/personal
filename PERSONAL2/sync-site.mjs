import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SITE = 'https://anma-portfolio-max0315.netlify.app/';
const siteUrl = process.argv[2] || DEFAULT_SITE;
const baseUrl = new URL(siteUrl);
const origin = baseUrl.origin;
const outputDir = process.env.OUTPUT_DIR ? join(ROOT, process.env.OUTPUT_DIR) : ROOT;

const queue = ['/'];
const queued = new Set(queue);
const visited = new Set();
const manifest = {
  source: origin + '/',
  syncedAt: new Date().toISOString(),
  resources: [],
};

const ignoredExtensions = new Set(['.map']);
const usefulExtensions = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.json', '.webmanifest', '.xml',
  '.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.avif',
  '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg', '.m4a',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

function canonicalPathname(pathname) {
  const raw = pathname.split('?')[0].split('#')[0] || '/';
  if (raw !== '/' && raw.endsWith('/') && extname(raw.slice(0, -1))) return raw.slice(0, -1);
  return raw;
}

function localPath(pathname) {
  const clean = canonicalPathname(pathname);
  const decoded = decodeURIComponent(clean);
  if (decoded === '/') return join(outputDir, 'index.html');
  const safe = normalize(decoded.replace(/^[/\\]+/, '')).replace(/^\.([/\\]|$)/, '');
  return join(outputDir, safe);
}

function shouldQueue(pathname) {
  const clean = canonicalPathname(pathname);
  if (!clean || clean === '/') return true;
  if (clean.startsWith('/api/') || clean.startsWith('/_next/data/')) return false;
  const ext = extname(clean).toLowerCase();
  return usefulExtensions.has(ext) && !ignoredExtensions.has(ext);
}

function addReference(raw, referenceBase) {
  if (!raw || raw.startsWith('#') || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('javascript:')) return;
  let url;
  try {
    url = new URL(raw, referenceBase);
  } catch {
    return;
  }
  if (url.origin !== origin || !shouldQueue(url.pathname)) return;
  const path = canonicalPathname(url.pathname) + (url.search || '');
  if (!queued.has(path)) {
    queued.add(path);
    queue.push(path);
  }
}

function discover(text, contentType, referenceBase) {
  const refs = new Set();
  const attrRe = /\b(?:src|href|poster|data-src|data-href)\s*=\s*["']([^"']+)["']/gi;
  const cssRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  const moduleRe = /\b(?:from|import\s*\()\s*["'`]([^"'`]+)["'`]/g;
  const rootStringRe = /["'`]((?:\/|\.\/)[^"'`\s)]+)["'`]/g;
  for (const re of [attrRe, cssRe, moduleRe, rootStringRe]) {
    let match;
    while ((match = re.exec(text))) refs.add(match[1]);
  }
  for (const ref of refs) addReference(ref, referenceBase);
  if (contentType.includes('text/html')) addReference('/favicon.ico', referenceBase);
}

async function saveResponse(url, response, body) {
  const filePath = localPath(url.pathname);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
  const bytes = Buffer.byteLength(body);
  manifest.resources.push({
    url: url.href,
    localPath: filePath.slice(outputDir.length + 1).replaceAll('\\', '/'),
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    bytes,
    sha256: createHash('sha256').update(body).digest('hex'),
  });
}

async function main() {
  while (queue.length) {
    const path = queue.shift();
    if (visited.has(path)) continue;
    visited.add(path);
    const url = new URL(path, origin + '/');
    let response;
    try {
      response = await fetch(url, { redirect: 'follow' });
    } catch (error) {
      manifest.resources.push({ url: url.href, status: 'error', error: String(error) });
      continue;
    }
    if (!response.ok) {
      manifest.resources.push({ url: url.href, status: response.status, statusText: response.statusText });
      continue;
    }
    const contentType = response.headers.get('content-type') || '';
    const body = Buffer.from(await response.arrayBuffer());
    await saveResponse(url, response, body);
    if (contentType.startsWith('text/') || /javascript|json|xml|svg/.test(contentType)) {
      discover(body.toString('utf8'), contentType, url.href);
    }
    console.log(`${response.status} ${url.pathname} (${body.length} bytes)`);
  }
  manifest.finishedAt = new Date().toISOString();
  manifest.resourceCount = manifest.resources.length;
  manifest.downloadedCount = manifest.resources.filter((item) => item.status === 200).length;
  manifest.failedCount = manifest.resources.length - manifest.downloadedCount;
  await writeFile(join(outputDir, 'mirror-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nDownloaded ${manifest.downloadedCount}/${manifest.resourceCount} resources into ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
