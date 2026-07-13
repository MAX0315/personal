import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const deployRoot = path.join(root, "deploy");
const siteRoot = path.join(deployRoot, "site");
const archivePath = path.join(deployRoot, "anmaai-site.tar.gz");

const arrays = ["tvcWorks", "adWorks", "feedWorks", "designWorks", "operation25Works", "ipWorks", "commercialWorks"];
const rootFiles = ["index.html", "video.html", "feed.html", "design.html", "script.js", "styles.css"];
const fontFiles = [
  "houzun-songti.ttf",
  "alibaba-puhuiti-regular.ttf",
  "alibaba-puhuiti-medium.ttf",
  "alibaba-puhuiti-semibold.ttf",
  "zihun-banma-kaiti-w2.ttf",
];

function emptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function readWorkArray(source, name) {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  if (start === -1) return [];

  const arrayStart = source.indexOf("[", start);
  let depth = 0;
  let end = -1;
  for (let i = arrayStart; i < source.length; i += 1) {
    if (source[i] === "[") depth += 1;
    if (source[i] === "]") depth -= 1;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }

  if (end === -1) throw new Error(`Cannot parse ${name}`);
  return JSON.parse(source.slice(arrayStart, end));
}

function collectReferencedAssets() {
  const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
  const work = Object.fromEntries(arrays.map((name) => [name, readWorkArray(script, name)]));
  const assets = new Set();

  for (const font of fontFiles) {
    assets.add(path.join("assets", font));
  }

  for (const item of [...work.tvcWorks, ...work.adWorks, ...work.feedWorks]) {
    assets.add(path.join("assets", "videos", item.source, item.file));
  }

  for (const item of work.designWorks) {
    assets.add(path.join("assets", "design", "operation-posters", item.file));
  }
  for (const item of work.operation25Works) {
    assets.add(path.join("assets", "design", "operation-25", item.file));
  }
  for (const item of work.ipWorks) {
    assets.add(path.join("assets", "design", "ip-series", item.file));
  }
  for (const item of work.commercialWorks) {
    assets.add(path.join("assets", "design", "commercial-posters", item.file));
  }

  return [...assets];
}

emptyDir(siteRoot);
fs.mkdirSync(deployRoot, { recursive: true });

for (const file of rootFiles) {
  copyFile(path.join(root, file), path.join(siteRoot, file));
}

let copiedBytes = 0;
let copiedCount = 0;
for (const relative of collectReferencedAssets()) {
  const from = path.join(root, relative);
  if (!fs.existsSync(from)) {
    console.warn(`Missing asset: ${relative}`);
    continue;
  }
  copyFile(from, path.join(siteRoot, relative));
  copiedBytes += fs.statSync(from).size;
  copiedCount += 1;
}

fs.rmSync(archivePath, { force: true });
execFileSync("tar", ["-czf", archivePath, "-C", siteRoot, "."], { stdio: "inherit" });

const archiveBytes = fs.statSync(archivePath).size;
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);

console.log(`Packaged ${copiedCount} assets (${mb(copiedBytes)} MB referenced media/fonts).`);
console.log(`Archive: ${archivePath}`);
console.log(`Archive size: ${mb(archiveBytes)} MB`);
