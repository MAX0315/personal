import fs from "node:fs";
import path from "node:path";
import { Client } from "ssh2";

const host = process.env.DEPLOY_HOST || "47.97.34.195";
const username = process.env.DEPLOY_USER || "root";
const password = process.env.DEPLOY_PASSWORD;
const filePairs = JSON.parse(process.env.DEPLOY_FILES || "[]");

if (!password || !filePairs.length) {
  console.error("DEPLOY_PASSWORD and DEPLOY_FILES are required.");
  process.exit(1);
}

const conn = new Client();

function connect() {
  return new Promise((resolve, reject) => {
    conn
      .on("ready", resolve)
      .on("error", reject)
      .connect({ host, port: 22, username, password, readyTimeout: 20000 });
  });
}

function sftp() {
  return new Promise((resolve, reject) => {
    conn.sftp((err, client) => (err ? reject(err) : resolve(client)));
  });
}

function upload(client, local, remote) {
  return new Promise((resolve, reject) => {
    const from = path.resolve(local);
    const read = fs.createReadStream(from);
    const write = client.createWriteStream(remote, { mode: 0o644 });
    read.on("error", reject);
    write.on("error", reject);
    write.on("close", resolve);
    read.pipe(write);
  });
}

await connect();
try {
  const client = await sftp();
  for (const [local, remote] of filePairs) {
    console.log(`[upload] ${local} -> ${remote}`);
    await upload(client, local, remote);
  }
  client.end();
} finally {
  conn.end();
}
