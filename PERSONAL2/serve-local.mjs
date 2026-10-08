import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dirname);
const port = Number(process.env.PORT || 4174);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function sendFile(request, response, filePath) {
  const stat = statSync(filePath);
  const range = request.headers.range;
  if (!range) {
    response.writeHead(200, {
      "content-type": types[extname(filePath)] || "application/octet-stream",
      "content-length": stat.size,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(response);
    return;
  }

  const match = range.match(/bytes=(\d+)-(\d*)/);
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Number(match[2]) : stat.size - 1;
  if (start >= stat.size || end < start) {
    response.writeHead(416, { "content-range": `bytes */${stat.size}` });
    response.end();
    return;
  }
  const safeEnd = Math.min(end, stat.size - 1);
  response.writeHead(206, {
    "content-type": types[extname(filePath)] || "application/octet-stream",
    "content-length": safeEnd - start + 1,
    "content-range": `bytes ${start}-${safeEnd}/${stat.size}`,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  });
  createReadStream(filePath, { start, end: safeEnd }).pipe(response);
}

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const target = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = normalize(join(root, target));
  if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  sendFile(request, response, filePath);
}).listen(port, "127.0.0.1", () => {
  console.log(`ANMA Netlify mirror at http://127.0.0.1:${port}`);
});
