// Filesystem locations used by the server. Server-only (Node APIs).
import path from "node:path";

/** kagaz-app/ — set by scripts/dev.mjs, else the parent of control/ (the Next.js cwd). */
export function rootDir(): string {
  const fromEnv = process.env.KAGAZ_ROOT;
  return fromEnv ? path.resolve(fromEnv) : path.resolve(process.cwd(), "..");
}

export function playgroundDir(): string {
  return path.join(rootDir(), "playground");
}

export function playgroundSrcDir(): string {
  return path.join(playgroundDir(), "src");
}

export function samplesDir(): string {
  return path.join(rootDir(), "samples");
}

export function snapshotsDir(): string {
  return path.join(rootDir(), "snapshots");
}

/** Runtime logs (gitignored): last-run.jsonl, last-run.stderr.log, last-run.cmd.txt */
export function runtimeDir(): string {
  return path.join(rootDir(), ".kagaz");
}

export function mockScriptPath(): string {
  return path.join(rootDir(), "scripts", "mock-claude.mjs");
}
