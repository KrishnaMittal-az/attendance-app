// Gallery of finished builds: snapshots/<id>/{src/, sketch.<ext>, meta.json}. No database.
import fs from "node:fs/promises";
import path from "node:path";
import { SAFE_ID } from "./http";
import { playgroundDir, playgroundSrcDir, snapshotsDir } from "./paths";
import { findSketch, removeSketches, type SketchFile } from "./playground";
import { emptyStats, type GalleryItem, type RunMode, type RunStats } from "./types";

export interface SnapshotMeta {
  id: string;
  createdAt: number;
  title: string;
  durationMs: number | null;
  stats: RunStats;
  mode: RunMode;
  tweaks: string[];
  sessionId: string | null;
  sketchName?: string | null; // display name of the sketch ("Todo app", "Phone photo")
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= 30) return slug || "app";
  const cut = slug.slice(0, 31);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash >= 12 ? cut.slice(0, lastDash) : cut.slice(0, 30)).replace(/-+$/g, "") || "app";
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function snapshotDir(id: string): string | null {
  if (!SAFE_ID.test(id)) return null;
  return path.join(snapshotsDir(), id);
}

/** Copies playground/src and the sketch into a new snapshot folder. Returns the snapshot id. */
export async function saveSnapshot(input: Omit<SnapshotMeta, "id" | "createdAt">): Promise<string> {
  const createdAt = Date.now();
  const base = `${stamp(new Date(createdAt))}-${slugify(input.title)}`;
  let id = base;
  for (let i = 2; await exists(path.join(snapshotsDir(), id)); i++) id = `${base}-${i}`;
  const dir = path.join(snapshotsDir(), id);
  await fs.mkdir(dir, { recursive: true });
  await fs.cp(playgroundSrcDir(), path.join(dir, "src"), { recursive: true });
  const sketch = await findSketch();
  if (sketch) await fs.copyFile(sketch.file, path.join(dir, sketch.name));
  const meta: SnapshotMeta = { id, createdAt, ...input };
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  return id;
}

function parseMeta(raw: unknown, id: string): SnapshotMeta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Partial<SnapshotMeta>;
  if (typeof m.createdAt !== "number") return null;
  return {
    id,
    createdAt: m.createdAt,
    title: typeof m.title === "string" && m.title.trim() ? m.title : "Untitled app",
    durationMs: typeof m.durationMs === "number" ? m.durationMs : null,
    stats: { ...emptyStats(), ...(typeof m.stats === "object" && m.stats ? m.stats : {}) },
    mode: m.mode === "tweak" ? "tweak" : "build",
    tweaks: Array.isArray(m.tweaks) ? m.tweaks.filter((t): t is string => typeof t === "string") : [],
    sessionId: typeof m.sessionId === "string" ? m.sessionId : null,
    sketchName: typeof m.sketchName === "string" ? m.sketchName : null,
  };
}

export async function readSnapshot(id: string): Promise<SnapshotMeta | null> {
  const dir = snapshotDir(id);
  if (!dir) return null;
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
    if (!(await exists(path.join(dir, "src")))) return null;
    return parseMeta(raw, id);
  } catch {
    return null;
  }
}

export async function snapshotSketch(id: string): Promise<SketchFile | null> {
  const dir = snapshotDir(id);
  return dir ? findSketch(dir) : null;
}

/** Newest first; broken folders are skipped. */
export async function listGallery(): Promise<GalleryItem[]> {
  let names: string[];
  try {
    names = await fs.readdir(snapshotsDir());
  } catch {
    return [];
  }
  const items = await Promise.all(
    names
      .filter((n) => SAFE_ID.test(n))
      .map(async (id): Promise<GalleryItem | null> => {
        const meta = await readSnapshot(id);
        if (!meta) return null;
        const sketch = await snapshotSketch(id);
        return {
          id,
          createdAt: meta.createdAt,
          title: meta.title,
          sketchUrl: sketch ? `/api/gallery/${id}/sketch` : null,
          durationMs: meta.durationMs,
          stats: meta.stats,
          mode: meta.mode,
          tweaks: meta.tweaks,
        };
      }),
  );
  return items.filter((i): i is GalleryItem => i !== null).sort((a, b) => b.createdAt - a.createdAt);
}

async function listFiles(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(dir, r)));
    else out.push(r);
  }
  return out;
}

/**
 * Copies a snapshot into the (already reset) playground: src/ is made identical to the snapshot's
 * src/ and the sketch is restored. Returns the restored sketch file name, if any.
 */
export async function copySnapshotToPlayground(id: string): Promise<string | null> {
  const dir = snapshotDir(id);
  if (!dir) throw new Error("Invalid snapshot id");
  const from = path.join(dir, "src");
  const to = playgroundSrcDir();
  await fs.cp(from, to, { recursive: true, force: true });
  const keep = new Set(await listFiles(from));
  for (const rel of await listFiles(to)) {
    if (!keep.has(rel)) await fs.rm(path.join(to, rel), { force: true });
  }
  await removeSketches();
  const sketch = await findSketch(dir);
  if (!sketch) return null;
  await fs.copyFile(sketch.file, path.join(playgroundDir(), sketch.name));
  return sketch.name;
}
