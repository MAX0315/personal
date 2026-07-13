import fs from "node:fs";
import path from "node:path";
import { Client } from "ssh2";

const host = process.env.DEPLOY_HOST || "47.97.34.195";
const username = process.env.DEPLOY_USER || "root";
const password = process.env.DEPLOY_PASSWORD;
const root = process.cwd();

if (!password) {
  console.error("DEPLOY_PASSWORD is required.");
  process.exit(1);
}

const uploads = [
  [path.join(root, "deploy", "anmaai-site.tar.gz"), "/tmp/anmaai-site.tar.gz"],
  [path.join(root, "deploy", "nginx", "anmaai.cn.conf"), "/tmp/anmaai.cn.conf"],
  [path.join(root, "deploy", "install_anmaai.sh"), "/tmp/install_anmaai.sh"],
];

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => resolve(conn))
      .on("error", reject)
      .connect({
        host,
        port: 22,
        username,
        password,
        readyTimeout: 20000,
        tryKeyboard: false,
      });
  });
}

function sftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftpClient) => (err ? reject(err) : resolve(sftpClient)));
  });
}

function uploadFile(sftpClient, local, remote) {
  const total = fs.statSync(local).size;
  let lastPct = -1;
  return new Promise((resolve, reject) => {
    const read = fs.createReadStream(local);
    const write = sftpClient.createWriteStream(remote, { mode: 0o644 });
    read.on("data", (chunk) => {
      const sent = write.bytesWritten + chunk.length;
      const pct = Math.floor((sent / total) * 100);
      if (pct >= lastPct + 10) {
        lastPct = pct;
        console.log(`[upload] ${path.basename(local)} ${Math.min(pct, 100)}%`);
      }
    });
    write.on("close", resolve);
    write.on("error", reject);
    read.on("error", reject);
    read.pipe(write);
  });
}

function exec(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: false }, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      stream
        .on("close", (code) => {
          if (stdout.trim()) console.log(stdout.trim());
          if (stderr.trim()) console.error(stderr.trim());
          code === 0 ? resolve(stdout) : reject(new Error(`Remote command failed (${code}): ${command}`));
        })
        .on("data", (data) => {
          stdout += data.toString();
        });
      stream.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    });
  });
}

const conn = await connect();
try {
  console.log(`[deploy] connected to ${host}`);
  const sftpClient = await sftp(conn);
  for (const [local, remote] of uploads) {
    console.log(`[upload] ${local} -> ${remote}`);
    await uploadFile(sftpClient, local, remote);
  }
  sftpClient.end();
  await exec(conn, "chmod +x /tmp/install_anmaai.sh && /tmp/install_anmaai.sh");
  await exec(conn, "curl -I --max-time 10 http://127.0.0.1/ || true");
  console.log("[deploy] done");
} finally {
  conn.end();
}
