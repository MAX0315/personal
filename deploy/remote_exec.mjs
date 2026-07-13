import { Client } from "ssh2";

const host = process.env.DEPLOY_HOST || "47.97.34.195";
const username = process.env.DEPLOY_USER || "root";
const password = process.env.DEPLOY_PASSWORD;
const command = process.env.DEPLOY_COMMAND;

if (!password || !command) {
  console.error("DEPLOY_PASSWORD and DEPLOY_COMMAND are required.");
  process.exit(1);
}

const conn = new Client();

conn
  .on("ready", () => {
    conn.exec(command, (err, stream) => {
      if (err) throw err;
      let stdout = "";
      let stderr = "";
      stream
        .on("close", (code) => {
          if (stdout.trim()) console.log(stdout.trim());
          if (stderr.trim()) console.error(stderr.trim());
          conn.end();
          process.exit(code || 0);
        })
        .on("data", (data) => {
          stdout += data.toString();
        });
      stream.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    });
  })
  .on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  })
  .connect({ host, port: 22, username, password, readyTimeout: 20000 });
