// Ready-made sketch photos in samples/ (the fallback when the camera fails).
import fs from "node:fs/promises";
import path from "node:path";
import { samplesDir } from "./paths";
import { CONTENT_TYPES, type ImageExt } from "./playground";
import type { SampleInfo } from "./types";

const KNOWN_NAMES: Record<string, string> = {
  todo: "Todo app",
  "chai-menu": "Chai shop menu",
  calculator: "Calculator",
};

const ORDER = ["todo", "chai-menu", "calculator"];
const IMAGE_RE = /^([A-Za-z0-9_-]+)\.(png|jpe?g|webp)$/i;
const EXT_PREFERENCE = ["png", "jpg", "jpeg", "webp"];

export interface SampleFile extends SampleInfo {
  file: string;
  ext: ImageExt;
  contentType: string;
}

function titleCase(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

async function scan(): Promise<SampleFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(samplesDir());
  } catch {
    return [];
  }
  const byId = new Map<string, SampleFile>();
  for (const name of names) {
    const m = IMAGE_RE.exec(name);
    if (!m) continue;
    const id = m[1];
    const rawExt = m[2].toLowerCase();
    const prev = byId.get(id);
    if (prev && EXT_PREFERENCE.indexOf(prev.file.split(".").pop()!.toLowerCase()) <= EXT_PREFERENCE.indexOf(rawExt))
      continue;
    byId.set(id, {
      id,
      name: KNOWN_NAMES[id] ?? titleCase(id),
      url: `/api/samples/${id}`,
      file: path.join(samplesDir(), name),
      ext: (rawExt === "jpeg" ? "jpg" : rawExt) as ImageExt,
      contentType: CONTENT_TYPES[rawExt],
    });
  }
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  return [...byId.values()].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

export async function listSamples(): Promise<SampleInfo[]> {
  return (await scan()).map(({ id, name, url }) => ({ id, name, url }));
}

/** Looks the id up in the directory listing (never builds a path from user input). */
export async function getSample(id: string): Promise<SampleFile | null> {
  return (await scan()).find((s) => s.id === id) ?? null;
}
