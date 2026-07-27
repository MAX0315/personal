import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dirname);
const tvcRoot = resolve("F:/AI视频/AI视频作品/TVC视频");
const adsRoot = resolve("F:/AI视频/AI视频作品/投放视频");
const port = Number(process.env.PORT || 4173);

const types = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith("/tvc/") || pathname.startsWith("/ads/")) {
    const mediaRoot = pathname.startsWith("/tvc/") ? tvcRoot : adsRoot;
    const mediaPath = normalize(join(mediaRoot, pathname.slice(5)));
    if (!mediaPath.startsWith(mediaRoot) || !existsSync(mediaPath) || !statSync(mediaPath).isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const stat = statSync(mediaPath);
    const range = request.headers.range;
    if (range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      const start = match ? Number(match[1]) : 0;
      const end = match && match[2] ? Number(match[2]) : stat.size - 1;
      response.writeHead(206, {
        "content-type": types[extname(mediaPath)] || "application/octet-stream",
        "content-length": end - start + 1,
        "content-range": `bytes ${start}-${end}/${stat.size}`,
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      });
      createReadStream(mediaPath, { start, end }).pipe(response);
      return;
    }

    response.writeHead(200, {
      "content-type": types[extname(mediaPath)] || "application/octet-stream",
      "content-length": stat.size,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    });
    createReadStream(mediaPath).pipe(response);
    return;
  }

  const target = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = normalize(join(root, target));

  if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": types[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Aetheris Voyage running at http://127.0.0.1:${port}`);
});
