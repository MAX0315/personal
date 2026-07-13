import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";

const root = path.resolve(".");
const srcRoot = "F:/AI视频/AI作品汇总";
const outDir = path.join(root, "assets/videos/feed");
const videoExts = new Set([".mp4", ".mov", ".m4v", ".webm"]);

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

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && videoExts.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => ({ name: entry.name, full: path.join(dir, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
}

function clearGeneratedFiles(dir) {
  ensureDir(dir);
  for (const name of fs.readdirSync(dir)) {
    if (/^feed-[pl]-\d+\.mp4$/i.test(name)) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
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

function syncGroup(files, prefix, category) {
  const works = [];
  for (let i = 0; i < files.length; i += 1) {
    const item = files[i];
    const info = probeVideo(item.full);
    const file = `${prefix}-${String(i + 1).padStart(3, "0")}.mp4`;
    console.log(`[video] ${prefix} ${i + 1}/${files.length}: ${item.name}`);
    encodeVideo(item.full, path.join(outDir, file), info);
    works.push({
      title: cleanLabel(item.name),
      file,
      orientation: info.orientation,
      source: "feed",
      category,
    });
  }
  return works;
}

function replaceArray(script, name, value) {
  const text = `const ${name} = ${JSON.stringify(value, null, 2)};\n\n`;
  const re = new RegExp(`const ${name} = \\[[\\s\\S]*?\\];\\n\\n`);
  if (!re.test(script)) throw new Error(`Array ${name} not found`);
  return script.replace(re, text);
}

clearGeneratedFiles(outDir);

const feedWorks = [
  ...syncGroup(listFiles(path.join(srcRoot, "信息流剪辑/信息流剪辑_竖版")), "feed-p", "信息流剪辑_竖"),
  ...syncGroup(listFiles(path.join(srcRoot, "信息流剪辑/信息流剪辑_横版")), "feed-l", "信息流剪辑_横"),
];

const scriptPath = path.join(root, "script.js");
const script = fs.readFileSync(scriptPath, "utf8");
fs.writeFileSync(scriptPath, replaceArray(script, "feedWorks", feedWorks), "utf8");

console.log(JSON.stringify({
  feed: feedWorks.length,
  portrait: feedWorks.filter((work) => work.category === "信息流剪辑_竖").length,
  landscape: feedWorks.filter((work) => work.category === "信息流剪辑_横").length,
}, null, 2));
