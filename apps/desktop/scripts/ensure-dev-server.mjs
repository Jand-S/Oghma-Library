import { spawn } from "node:child_process";

const devUrl = "http://127.0.0.1:5173";

async function isDevServerReady() {
  try {
    const response = await fetch(devUrl, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

if (await isDevServerReady()) {
  console.log(`Vite dev server already running at ${devUrl}`);
  process.exit(0);
}

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(command, ["run", "dev"], {
  stdio: "inherit",
  shell: true
});

function stopChild() {
  if (!child.killed) child.kill();
}

process.on("SIGINT", stopChild);
process.on("SIGTERM", stopChild);
process.on("exit", stopChild);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
