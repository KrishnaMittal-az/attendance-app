#!/usr/bin/env node
// Starts the control app (Next.js, 127.0.0.1:3000) and the playground preview (Vite, localhost:5173)
// together. `node scripts/dev.mjs --mock` runs a fake Claude so you can rehearse without using your plan.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mock = process.argv.includes("--mock") || process.env.KAGAZ_MOCK === "1";
const isWin = process.platform === "win32";

for (const dir of ["control", "playground"]) {
  if (!existsSync(path.join(root, dir, "node_modules"))) {
    console.error(`\n✗ ${dir}/node_modules is missing. Run \`npm run setup\` in ${root} first.\n`);
    process.exit(1);
  }
}

if (!mock) {
  const bin = process.env.KAGAZ_CLAUDE_BIN || "claude";
  const probe = spawnSync(bin, ["--version"], { encoding: "utf8", shell: isWin });
  if (probe.status !== 0) {
    console.error(`\n⚠ Could not run \`${bin} --version\`. Install Claude Code and run \`claude\` once to log in,`);
    console.error("  or rehearse with `npm run dev:mock`.\n");
  } else {
    console.log(`✓ Claude Code ${probe.stdout.trim()}`);
  }
}

const env = { ...process.env, KAGAZ_ROOT: root, ...(mock ? { KAGAZ_MOCK: "1" } : {}) };
const colors = { control: "\x1b[36m", preview: "\x1b[35m" };
const children = [];
let shuttingDown = false;

function run(name, cwd) {
  // Own process group (detached) so shutdown can kill npm *and* the dev server it started.
  const child = spawn("npm", ["run", "dev"], { cwd: path.join(root, cwd), env, shell: isWin, detached: !isWin });
  const prefix = `${colors[name]}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) out.write(prefix + line + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`${prefix}exited with code ${code}; stopping everything.`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
}

function killTree(child, signal) {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else process.kill(-child.pid, signal); // the whole group: npm, sh and next/vite
  } catch {
    // already gone
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child, "SIGTERM");
  setTimeout(() => {
    for (const child of children) killTree(child, "SIGKILL");
    process.exit(code);
  }, 1500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));

console.log(`\n  Kagaz → App ${mock ? "(MOCK Claude — rehearsal mode)" : ""}`);
console.log("  Stage screen:  http://localhost:3000");
console.log("  Live preview:  http://localhost:5173\n");
run("control", "control");
run("preview", "playground");
