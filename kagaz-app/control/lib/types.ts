// Shared contract between the API routes (server) and the stage UI (client).
// Keep this file free of Node imports so client components can import it.

export type RunStatus = "idle" | "running" | "done" | "error" | "stopped";
export type RunMode = "build" | "tweak";

/**
 * One line in the terminal-style activity feed.
 * - system:   our own status lines ("Starting Claude Code…", "Playground reset")
 * - user:     the tweak text the presenter typed
 * - read:     Claude read a file ("Reading sketch…")
 * - write:    Claude is creating a file ("Creating App.tsx…", detail "142 lines")
 * - edit:     Claude is editing a file ("Editing App.tsx…")
 * - step:     a short narration line from Claude ("Adding cart logic")
 * - thinking: Claude is thinking (no content shown)
 * - done:     the run finished ("Done in 47s")
 * - error:    something failed
 */
export type FeedKind =
  | "system"
  | "user"
  | "read"
  | "write"
  | "edit"
  | "step"
  | "thinking"
  | "done"
  | "error";

export interface FeedItem {
  id: number; // unique, increasing for the lifetime of the server
  at: number; // epoch ms when the item was created
  kind: FeedKind;
  text: string; // single display line
  detail?: string; // dim suffix, e.g. "142 lines"
  live?: boolean; // still streaming (show a spinner/cursor)
}

export interface RunStats {
  filesCreated: number; // distinct files Claude created with Write
  filesEdited: number; // distinct existing files Claude changed (Write over existing or Edit)
  linesWritten: number; // lines in Write contents + Edit new_string
  toolCalls: number;
  durationMs: number | null; // wall clock, upload → result
  costUsd: number | null; // from the result message (estimate)
  turns: number | null; // num_turns from the result message
}

export interface KagazConfig {
  model: string | null; // --model passed to claude, null = CLI default
  effort: string | null; // --effort passed to claude, null = not passed
  mock: boolean; // KAGAZ_MOCK=1 (rehearsal mode, fake Claude)
  previewUrl: string; // iframe src, default http://localhost:5173
  cliVersion: string | null; // output of `claude --version`, if known
  cliOk: boolean | null; // null = not checked yet, false = `claude --help` failed (not installed / not on PATH)
}

/** Plan usage from the CLI's rate_limit_event (Claude subscription limits). */
export interface PlanUsage {
  status: string | null; // "allowed", "allowed_warning", "rejected", …
  fiveHour: number | null; // utilization of the 5-hour window, 0..1
  sevenDay: number | null; // utilization of the 7-day window, 0..1
  resetsAt: number | null; // epoch ms when the limiting window resets
  at: number; // when we last heard
}

export interface KagazState {
  status: RunStatus;
  mode: RunMode | null;
  runId: number; // increments for every build/tweak
  startedAt: number | null; // epoch ms when the upload/tweak was accepted (timer start)
  finishedAt: number | null; // epoch ms when Claude finished (timer stop)
  buildStartedAt: number | null; // start of the original build this app came from (for the "total" time)
  sketch: { url: string; name: string } | null; // url like /api/sketch?v=3
  sessionId: string | null; // Claude session id used for --resume
  canTweak: boolean; // an app exists in the playground
  feed: FeedItem[]; // current app's feed (build + its tweaks), capped at ~300 items
  stats: RunStats; // stats of the latest run
  summary: string | null; // Claude's final one-sentence description
  error: string | null;
  previewVersion: number; // bump → UI reloads the iframe (after reset/restore)
  usage: PlanUsage | null; // last plan-usage report from Claude Code (kept across runs)
  config: KagazConfig;
}

export interface GalleryItem {
  id: string; // folder name in snapshots/
  createdAt: number;
  title: string; // Claude's summary or "Untitled app"
  sketchUrl: string | null; // /api/gallery/<id>/sketch
  durationMs: number | null;
  stats: RunStats;
  mode: RunMode;
  tweaks: string[]; // tweak texts applied before this snapshot
}

export interface PhoneInfo {
  enabled: boolean;
  url: string | null; // http://<lan-ip>:3001/?t=<token>
  qrSvg: string | null; // inline SVG markup of the QR code for url
  addresses: string[]; // all candidate LAN IPv4 addresses
  port: number;
  error: string | null; // e.g. port in use
}

export interface SampleInfo {
  id: string; // "todo" | "chai-menu" | "calculator"
  name: string; // "Todo app"
  url: string; // /api/samples/todo
}

export interface ApiError {
  error: string;
}

export function emptyStats(): RunStats {
  return {
    filesCreated: 0,
    filesEdited: 0,
    linesWritten: 0,
    toolCalls: 0,
    durationMs: null,
    costUsd: null,
    turns: null,
  };
}
