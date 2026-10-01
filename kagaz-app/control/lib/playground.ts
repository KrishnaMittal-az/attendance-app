// The Vite app Claude edits: reset to the committed template, and the sketch photo stored inside it.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./http";
import { playgroundDir, rootDir } from "./paths";

export type ImageExt = "jpg" | "png" | "webp" | "gif";

export const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const SKETCH_RE = /^sketch\.(jpg|jpeg|png|webp|gif)$/i;

export const RESET_NEEDS_GIT =
  "Reset needs git: kagaz-app must be inside a git checkout with playground/ committed";

function git(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: rootDir(), timeout: 20_000, shell: false }, (err, _stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve();
    });
  });
}

/** git checkout + clean of playground/ (node_modules and other ignored files survive), sketch removed. */
export async function resetPlaygroundFiles(): Promise<void> {
  try {
    await git(["checkout", "HEAD", "--", "playground"]);
    await git(["clean", "-fdq", "--", "playground"]);
  } catch (err) {
    console.error("[kagaz] git reset of playground/ failed:", (err as Error).message);
    throw new HttpError(500, RESET_NEEDS_GIT);
  }
  await removeSketches();
}

export async function removeSketches(): Promise<void> {
  let names: string[] = [];
  try {
    names = await fs.readdir(playgroundDir());
  } catch {
    return;
  }
  await Promise.all(
    names.filter((n) => SKETCH_RE.test(n)).map((n) => fs.rm(path.join(playgroundDir(), n), { force: true })),
  );
}

/** Saves playground/sketch.<ext> (any other sketch.* is removed first); returns the file name. */
export async function writeSketch(data: Buffer, ext: ImageExt): Promise<string> {
  await removeSketches();
  const name = `sketch.${ext}`;
  await fs.writeFile(path.join(playgroundDir(), name), data);
  return name;
}

export interface SketchFile {
  file: string; // absolute path
  name: string; // e.g. sketch.jpg
  ext: string;
  contentType: string;
}

/** Finds an image named sketch.<ext> in `dir` (defaults to playground/). */
export async function findSketch(dir: string = playgroundDir()): Promise<SketchFile | null> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  const name = names.find((n) => SKETCH_RE.test(n));
  if (!name) return null;
  const ext = name.split(".").pop()!.toLowerCase();
  return { file: path.join(dir, name), name, ext, contentType: CONTENT_TYPES[ext] ?? "application/octet-stream" };
}

/** Identify an image from its first bytes. HEIC/HEIF is recognised so we can refuse it nicely. */
export function sniffImage(data: Buffer): ImageExt | "heic" | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "png";
  if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP")
    return "webp";
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.toString("latin1", 0, 6))) return "gif";
  if (data.length >= 12 && data.toString("latin1", 4, 8) === "ftyp") {
    const brand = data.toString("latin1", 8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(brand)) return "heic";
  }
  return null;
}
