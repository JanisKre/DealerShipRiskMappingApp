import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import electronPath from "electron";

await access("out/main/index.cjs");
await access("out/preload/index.cjs");
await access("out/renderer/index.html");

// The local Codex sandbox has no macOS display server. Linux CI runs the
// process under Xvfb, while macOS developers can run the app normally via
// `npm run dev`.
if (process.platform === "darwin" && !process.env.DISPLAY) {
  console.log(
    "Electron smoke test skipped: no macOS display server available.",
  );
  process.exit(0);
}

const child = spawn(electronPath, ["out/main/index.cjs", "--disable-gpu"], {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_ENABLE_SECURITY_WARNINGS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const exitCode = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    resolve(0);
  }, 2500);
  child.once("error", reject);
  child.once("exit", (code) => {
    clearTimeout(timer);
    resolve(code ?? 1);
  });
});

if (exitCode !== 0) {
  throw new Error(`Electron smoke test exited with ${exitCode}: ${output}`);
}

console.log("Electron smoke test passed: main, preload, and renderer started.");
