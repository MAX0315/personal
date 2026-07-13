import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";

const root = path.resolve(".");
const srcRoot = "F:/AI视频/AI作品汇总";
const videoExts = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanLabel(name) {
  return path.basename(name, path.extname(name))
    .replaceAll("横板", "横")
    .replaceAll("横版", "横")
    .replaceAll("竖板", "竖")
    .replaceAll("竖版", "竖")
    .replaceAll("方板", "方")
    .replaceAll("方版", "方");
}

function listFiles(dir, exts, category = null) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && exts.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => ({
      name: entry.name,
      full: path.join(dir, entry.name),
      ext: path.extname(entry.name).toLowerCase(),
      category,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
}

function clearGeneratedFiles(dir, prefixRegex) {
  ensureDir(dir);
  for (const name of fs.readdirSync(dir)) {
    if (!prefixRegex || prefixRegex.test(name)) fs.rmSync(path.join(dir, name), { force: true });
  }
}

function probeVideo(file) {
  const result = cp.spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x",
    file,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffprobe failed for ${file}: ${result.stderr}`);
  const [width, height] = result.stdout.trim().split("x").map(Number);
  return { width, height, orientation: width > height ? "landscape" : "portrait" };
}

function encodeVideo(src, out, info) {
  const scale = info.width > info.height ? "scale=1280:-2" : "scale=-2:1280";
  const result = cp.spawnSync("ffmpeg", [
    "-y", "-i", src,
    "-map", "0:v:0", "-map", "0:a?",
    "-vf", scale,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    out,
  ], { stdio: "ignore" });
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${src}`);
}

function syncVideoGroup(files, outDir, prefix, source, priorityTitles = [], category = null) {
  ensureDir(outDir);
  const priority = new Map(priorityTitles.map((title, index) => [title, index]));
  const sorted = [...files].sort((a, b) => {
    const ta = cleanLabel(a.name);
    const tb = cleanLabel(b.name);
    const pa = priority.has(ta) ? priority.get(ta) : 9999;
    const pb = priority.has(tb) ? priority.get(tb) : 9999;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
  });

  const works = [];
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const info = probeVideo(item.full);
    const file = `${prefix}-${String(i + 1).padStart(3, "0")}.mp4`;
    const out = path.join(outDir, file);
    console.log(`[video] ${prefix} ${i + 1}/${sorted.length}: ${item.name}`);
    encodeVideo(item.full, out, info);
    const work = { title: cleanLabel(item.name), file, orientation: info.orientation, source };
    if (item.category || category) work.category = item.category || category;
    works.push(work);
  }
  return works;
}

function copyImageGroup(srcDir, outDir, prefix, extra = {}) {
  ensureDir(outDir);
  const files = listFiles(srcDir, imageExts);
  return files.map((item, index) => {
    const file = `${prefix}-${String(index + 1).padStart(3, "0")}${item.ext}`;
    fs.copyFileSync(item.full, path.join(outDir, file));
    return { title: cleanLabel(item.name), file, ...extra };
  });
}

function replaceArray(script, name, value) {
  const text = `const ${name} = ${JSON.stringify(value, null, 2)};\n\n`;
  const re = new RegExp(`const ${name} = \\[[\\s\\S]*?\\];\\n\\n`);
  if (!re.test(script)) throw new Error(`Array ${name} not found`);
  return script.replace(re, text);
}

function sumDir(dir) {
  if (!fs.existsSync(dir)) return { count: 0, mb: 0 };
  const files = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile());
  const bytes = files.reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0);
  return { count: files.length, mb: Math.round(bytes / 1024 / 1024) };
}

const tvcOut = path.join(root, "assets/videos/tvc");
const adsOut = path.join(root, "assets/videos/ads");
const feedOut = path.join(root, "assets/videos/feed");
const opOut = path.join(root, "assets/design/operation-posters");
const op25Out = path.join(root, "assets/design/operation-25");
const ipOut = path.join(root, "assets/design/ip-series");
const commercialOut = path.join(root, "assets/design/commercial-posters");

clearGeneratedFiles(tvcOut, /^tvc-\d+\.mp4$/i);
clearGeneratedFiles(adsOut, /^ads-\d+\.mp4$/i);
clearGeneratedFiles(feedOut, /^feed-[pl]-\d+\.mp4$/i);
clearGeneratedFiles(opOut);
clearGeneratedFiles(op25Out);
clearGeneratedFiles(ipOut);
clearGeneratedFiles(commercialOut);

const tvcSourceFiles = [
  ...listFiles(path.join(srcRoot, "AI视频作品/TVC视频"), videoExts),
  ...listFiles(path.join(srcRoot, "AI视频作品/TVC案例_横"), videoExts, "TVC案例_横"),
  ...listFiles(path.join(srcRoot, "AI视频作品/TVC案例_竖"), videoExts, "TVC案例_竖"),
];

const tvcWorks = syncVideoGroup(
  tvcSourceFiles,
  tvcOut,
  "tvc",
  "tvc",
  ["3D跑鞋", "人体工学椅"],
);

const adWorks = syncVideoGroup([
  ...listFiles(path.join(srcRoot, "AI视频作品/投放视频_横"), videoExts, "投放案例_横"),
  ...listFiles(path.join(srcRoot, "AI视频作品/26_投放视频"), videoExts, "投放案例_竖"),
  ...listFiles(path.join(srcRoot, "AI视频作品/投放视频_竖"), videoExts, "投放案例_竖"),
], adsOut, "ads", "ads", ["Jackery_横3840_草地", "Jackery_横3840_城市"]);

const feedWorks = [
  ...syncVideoGroup(
    listFiles(path.join(srcRoot, "信息流剪辑/信息流剪辑_竖版"), videoExts),
    feedOut,
    "feed-p",
    "feed",
    [],
    "信息流剪辑_竖",
  ),
  ...syncVideoGroup(
    listFiles(path.join(srcRoot, "信息流剪辑/信息流剪辑_横版"), videoExts),
    feedOut,
    "feed-l",
    "feed",
    [],
    "信息流剪辑_横",
  ),
];

const designWorks = [
  ...copyImageGroup(path.join(srcRoot, "AI设计作品/运营海报_横"), opOut, "op-h", { category: "运营海报_横", orientation: "landscape" }),
  ...copyImageGroup(path.join(srcRoot, "AI设计作品/运营海报_竖"), opOut, "op-v", { category: "运营海报_竖", orientation: "portrait" }),
];
const operation25Works = copyImageGroup(path.join(srcRoot, "AI设计作品/25运营"), op25Out, "op25", { folder: "operation-25", orientation: "portrait" });
const ipWorks = copyImageGroup(path.join(srcRoot, "AI设计作品/IP系列"), ipOut, "ip", { folder: "ip-series" });
const commercialWorks = [
  ...copyImageGroup(path.join(srcRoot, "AI设计作品/商业化海报_横"), commercialOut, "commercial-h", { folder: "commercial-posters", orientation: "landscape" }),
  ...copyImageGroup(path.join(srcRoot, "AI设计作品/商业化海报_竖"), commercialOut, "commercial-v", { folder: "commercial-posters", orientation: "portrait" }),
];

const scriptPath = path.join(root, "script.js");
let script = fs.readFileSync(scriptPath, "utf8");
script = replaceArray(script, "tvcWorks", tvcWorks);
script = replaceArray(script, "adWorks", adWorks);
script = replaceArray(script, "feedWorks", feedWorks);
script = replaceArray(script, "designWorks", designWorks);
script = replaceArray(script, "operation25Works", operation25Works);
script = replaceArray(script, "ipWorks", ipWorks);
script = replaceArray(script, "commercialWorks", commercialWorks);
fs.writeFileSync(scriptPath, script, "utf8");

console.log(JSON.stringify({
  video: {
    tvc: tvcWorks.length,
    ads: adWorks.length,
    feed: feedWorks.length,
    tvcBreakdown: {
      landscape: tvcWorks.filter((work) => work.orientation === "landscape").length,
      portrait: tvcWorks.filter((work) => work.orientation === "portrait").length,
    },
    adsBreakdown: {
      landscape: adWorks.filter((work) => work.orientation === "landscape").length,
      portrait: adWorks.filter((work) => work.orientation === "portrait").length,
    },
  },
  images: {
    operation: designWorks.length,
    operation25: operation25Works.length,
    ip: ipWorks.length,
    commercial: commercialWorks.length,
  },
  assetSizes: {
    tvc: sumDir(tvcOut),
    ads: sumDir(adsOut),
    feed: sumDir(feedOut),
    operation: sumDir(opOut),
    operation25: sumDir(op25Out),
    ip: sumDir(ipOut),
    commercial: sumDir(commercialOut),
  },
}, null, 2));
