// Client-side helpers for the stage screen: fetch wrappers, image downscaling,
// time formatting and a defensive copy of the server state.

import { emptyStats, type KagazState } from "@/lib/types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ API */

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export const BUSY_MESSAGE = "Claude is still building — press Stop first";

/** fetch() that never throws; API errors come back as JSON { error }. */
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", ...init });
  } catch {
    return { ok: false, status: 0, error: "Can’t reach the control server — is it running?" };
  }
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (res.ok) return { ok: true, status: res.status, data: body as T };
  return { ok: false, status: res.status, error: errorText(body, res.status) };
}

function errorText(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error: unknown }).error;
    if (typeof e === "string" && e.trim()) return e;
  }
  if (typeof body === "string") {
    const t = body.trim();
    if (t && t.length < 200 && !t.startsWith("<")) return t;
  }
  return `Request failed (HTTP ${status})`;
}

export function postJson<T = unknown>(path: string, body: unknown = {}): Promise<ApiResult<T>> {
  return api<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Toast text for a failed request: 409 always means "a run is active". */
export function failureText(r: { status: number; error: string }): string {
  return r.status === 409 ? BUSY_MESSAGE : r.error;
}

/** Accept either a bare array or an object wrapping one ({ items: [...] }). */
export function asArray<T>(data: unknown, ...keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    for (const key of [...keys, "items"]) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

/* ---------------------------------------------------------------- state */

export const DEFAULT_PREVIEW_URL = "http://localhost:5173";

export function initialState(): KagazState {
  return {
    status: "idle",
    mode: null,
    runId: 0,
    startedAt: null,
    finishedAt: null,
    buildStartedAt: null,
    sketch: null,
    sessionId: null,
    canTweak: false,
    feed: [],
    stats: emptyStats(),
    summary: null,
    error: null,
    previewVersion: 0,
    usage: null,
    config: {
      model: null,
      effort: null,
      mock: false,
      previewUrl: DEFAULT_PREVIEW_URL,
      cliVersion: null,
      cliOk: null,
    },
  };
}

/** Fill any missing fields so a partial/older server object can't crash the UI. */
export function normalizeState(raw: unknown): KagazState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<KagazState>;
  if (typeof s.status !== "string") return null;
  const base = initialState();
  return {
    ...base,
    ...s,
    feed: Array.isArray(s.feed) ? s.feed : [],
    stats: { ...base.stats, ...(s.stats ?? {}) },
    config: {
      ...base.config,
      ...(s.config ?? {}),
      previewUrl: s.config?.previewUrl || DEFAULT_PREVIEW_URL,
    },
  };
}

/** Value shown by the big timer. */
export function timerMs(s: KagazState, now: number): number {
  if (s.status === "running" && s.startedAt != null) return now - s.startedAt;
  if (s.startedAt != null && s.finishedAt != null) return s.finishedAt - s.startedAt;
  return s.stats.durationMs ?? 0;
}

/** Duration of the latest finished run, for the stats card. */
export function runDurationMs(s: KagazState): number | null {
  if (s.stats.durationMs != null) return s.stats.durationMs;
  if (s.startedAt != null && s.finishedAt != null) return s.finishedAt - s.startedAt;
  return null;
}

/* --------------------------------------------------------------- images */

const MAX_SIDE = 1600;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|svg)$/i;

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || (!file.type && IMAGE_EXT.test(file.name));
}

export function firstImage(files: FileList | null | undefined): File | null {
  if (!files) return null;
  for (const file of Array.from(files)) if (isImageFile(file)) return file;
  return null;
}

/**
 * Downscale a photo in the browser (longest side ≤ 1600 px, EXIF orientation applied,
 * JPEG 0.85). Phone photos shrink from ~4 MB to ~300 KB. Falls back to the original
 * file if the browser can't decode it (e.g. HEIC on Chrome).
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; name: string }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = "#ffffff"; // transparent PNGs become white paper, not black
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) throw new Error("encode failed");
      return { blob, name: "sketch.jpg" };
    } finally {
      bitmap.close();
    }
  } catch {
    return { blob: file, name: file.name || "sketch" };
  }
}

/* ----------------------------------------------------------------- time */

/** Stopwatch format: "7.4s", "47.2s", "1m 04.2s" (floored to tenths). */
export function formatDuration(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const totalSec = Math.floor(tenths / 10);
  const t = tenths % 10;
  if (totalSec < 60) return `${totalSec}.${t}s`;
  const m = Math.floor(totalSec / 60);
  return `${m}m ${String(totalSec % 60).padStart(2, "0")}.${t}s`;
}

/** Feed timestamp: "+12.3s", "+1m04s". */
export function formatOffset(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const totalSec = Math.floor(tenths / 10);
  if (totalSec < 60) return `+${totalSec}.${tenths % 10}s`;
  return `+${Math.floor(totalSec / 60)}m${String(totalSec % 60).padStart(2, "0")}s`;
}

export function timeAgo(ts: number, now: number = Date.now()): string {
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function previewHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}
