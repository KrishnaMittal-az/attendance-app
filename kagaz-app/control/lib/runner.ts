// Runs Claude Code headless in playground/: one run at a time, build or tweak, with stop/timeout/reset.
// Everything mutable lives on globalThis so it survives Next.js dev HMR.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildArgs,
  buildPrompt,
  claudeBin,
  claudeCommand,
  claudeEnv,
  describeCommand,
  detectFeatures,
  freshTweakPrompt,
  tweakPrompt,
} from "./claude";
import { copySnapshotToPlayground, readSnapshot, saveSnapshot } from "./gallery";
import { BusyError, HttpError } from "./http";
import { playgroundDir, runtimeDir } from "./paths";
import { findSketch, resetPlaygroundFiles, writeSketch, type ImageExt } from "./playground";
import { getSample } from "./samples";
import { addFeed, getState, resetFeed, settleLiveFeed, update } from "./store";
import { cleanLine, StreamReducer, type ResultInfo } from "./stream";
import { emptyStats, type RunMode } from "./types";

interface Proc {
  seq: number;
  runId: number;
  mode: RunMode;
  child: ChildProcess | null;
  reducer: StreamReducer;
  usedResume: boolean;
  retried: boolean; // this process is already the fresh-session fallback
  tweakText: string | null;
  stopped: boolean; // killed on purpose (stop, timeout, superseded): its exit is not an error
  finished: boolean; // final state already written
  resultHandled: boolean;
  retryOnExit: boolean;
  exited: boolean;
  exitPromise: Promise<void>;
  resolveExit: () => void;
  timers: ReturnType<typeof setTimeout>[];
  stderrTail: string;
  stdoutLog: fs.WriteStream | null;
  stderrLog: fs.WriteStream | null;
}

interface RunnerGlobal {
  proc: Proc | null;
  seq: number;
  tweaks: string[]; // tweak texts applied since the build (for the gallery)
  buildTitle: string | null; // the build's summary, used as the gallery title for its tweaks
  maintenance: string | null; // reset/restore in progress
  snapshotting: Promise<void>;
}

const g = globalThis as typeof globalThis & { __kagazRunner?: RunnerGlobal };

function runner(): RunnerGlobal {
  if (!g.__kagazRunner) {
    g.__kagazRunner = {
      proc: null,
      seq: 0,
      tweaks: [],
      buildTitle: null,
      maintenance: null,
      snapshotting: Promise.resolve(),
    };
  }
  return g.__kagazRunner;
}

const STDERR_TAIL = 4000;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function timeoutMs(): number {
  const n = Number.parseInt(process.env.KAGAZ_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 300_000;
}

function formatDuration(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`;
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${Math.round(ms / 1000)} s`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function cleanSummary(text: string | null): string | null {
  if (!text) return null;
  const flat = text
    .split("\n")
    .map((l) => cleanLine(l))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return flat ? truncate(flat, 300) : null;
}

function isRunCurrent(runId: number): boolean {
  const s = getState();
  return s.runId === runId && s.status === "running";
}

function isProcCurrent(proc: Proc): boolean {
  return runner().proc === proc && !proc.stopped && !proc.finished && isRunCurrent(proc.runId);
}

function assertIdle(): void {
  const r = runner();
  if (getState().status === "running") throw new BusyError();
  if (r.maintenance) throw new BusyError(`Hold on — ${r.maintenance}`);
}

// --- process control ---------------------------------------------------------------------------------

function killProc(proc: Proc): void {
  const child = proc.child;
  if (!child || proc.exited) return;
  const send = (signal: NodeJS.Signals) => {
    if (proc.exited) return;
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  };
  send("SIGINT");
  proc.timers.push(setTimeout(() => send("SIGTERM"), 3000));
  proc.timers.push(setTimeout(() => send("SIGKILL"), 6000));
}

/** Stops any leftover process (e.g. one still shutting down) and waits up to `ms` for it to exit. */
async function stopProcessAndWait(ms = 4000): Promise<void> {
  const proc = runner().proc;
  if (!proc || proc.exited) return;
  proc.stopped = true;
  killProc(proc);
  await Promise.race([proc.exitPromise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

function closeLogs(proc: Proc): void {
  proc.stdoutLog?.end();
  proc.stderrLog?.end();
  proc.stdoutLog = null;
  proc.stderrLog = null;
}

function openLogs(proc: Proc, append: boolean, commandLine: string): void {
  try {
    fs.mkdirSync(runtimeDir(), { recursive: true });
    const flags = append ? "a" : "w";
    proc.stdoutLog = fs.createWriteStream(path.join(runtimeDir(), "last-run.jsonl"), { flags });
    proc.stderrLog = fs.createWriteStream(path.join(runtimeDir(), "last-run.stderr.log"), { flags });
    proc.stdoutLog.on("error", () => (proc.stdoutLog = null));
    proc.stderrLog.on("error", () => (proc.stderrLog = null));
    const header = `# run ${proc.runId} (${proc.mode}${proc.retried ? ", fresh-session retry" : ""}) ${new Date().toISOString()}\n$ ${commandLine}\n`;
    if (append) fs.appendFileSync(path.join(runtimeDir(), "last-run.cmd.txt"), `\n${header}`);
    else fs.writeFileSync(path.join(runtimeDir(), "last-run.cmd.txt"), header);
  } catch (err) {
    console.warn("[kagaz] could not open run logs:", (err as Error).message);
  }
}

interface SpawnOptions {
  runId: number;
  mode: RunMode;
  prompt: string;
  resume: string | null;
  tweakText: string | null;
  retried: boolean;
}

async function spawnClaude(opts: SpawnOptions): Promise<void> {
  const features = await detectFeatures();
  if (!isRunCurrent(opts.runId)) return; // stopped while we were getting ready
  const r = runner();
  const { cmd, prefix } = claudeCommand();
  const args = [...prefix, ...buildArgs(features, { resume: opts.resume })];
  const commandLine = describeCommand(cmd, args);
  console.log(`[kagaz] run ${opts.runId} (${opts.mode}) in ${playgroundDir()}\n[kagaz] $ ${commandLine}`);

  let resolveExit = () => {};
  const exitPromise = new Promise<void>((resolve) => (resolveExit = resolve));
  const proc: Proc = {
    seq: ++r.seq,
    runId: opts.runId,
    mode: opts.mode,
    child: null,
    reducer: null as unknown as StreamReducer,
    usedResume: Boolean(opts.resume),
    retried: opts.retried,
    tweakText: opts.tweakText,
    stopped: false,
    finished: false,
    resultHandled: false,
    retryOnExit: false,
    exited: false,
    exitPromise,
    resolveExit,
    timers: [],
    stderrTail: "",
    stdoutLog: null,
    stderrLog: null,
  };
  proc.reducer = new StreamReducer(playgroundDir(), () => isProcCurrent(proc));
  r.proc = proc;
  openLogs(proc, opts.retried, commandLine);

  let child: ChildProcess;
  try {
    child = spawn(cmd, args, {
      cwd: playgroundDir(),
      env: claudeEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
  } catch (err) {
    onSpawnError(proc, err as NodeJS.ErrnoException);
    return;
  }
  proc.child = child;
  child.on("error", (err) => onSpawnError(proc, err as NodeJS.ErrnoException));
  child.on("close", (code, signal) => onClose(proc, code, signal));

  child.stdin?.on("error", () => {
    /* EPIPE if the CLI exits early; the exit handler reports it */
  });
  child.stdin?.end(opts.prompt);

  let buf = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      onLine(proc, line);
    }
  });
  child.stdout?.on("end", () => {
    if (buf) onLine(proc, buf);
    buf = "";
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    proc.stderrLog?.write(chunk);
    proc.stderrTail = (proc.stderrTail + chunk).slice(-STDERR_TAIL);
  });

  proc.timers.push(setTimeout(() => onTimeout(proc), timeoutMs()));
}

function onLine(proc: Proc, line: string): void {
  proc.stdoutLog?.write(`${line}\n`);
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return;
  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (!isProcCurrent(proc)) return;
  proc.reducer.handle(event);
  if (proc.reducer.result && !proc.resultHandled) {
    proc.resultHandled = true;
    onResult(proc, proc.reducer.result);
  }
}

function stderrMessage(proc: Proc): string | null {
  const lines = proc.stderrTail
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return truncate(lines.slice(-3).join(" "), 300);
}

function canRetryFresh(proc: Proc): boolean {
  return proc.mode === "tweak" && proc.usedResume && !proc.retried && !proc.stopped && !proc.reducer.usedTools;
}

function resultErrorMessage(proc: Proc, res: ResultInfo): string {
  if (res.text) return res.text;
  if (res.subtype === "error_max_turns") return "Claude hit the turn limit before finishing";
  return stderrMessage(proc) ?? `Claude Code stopped with an error (${res.subtype})`;
}

function onResult(proc: Proc, res: ResultInfo): void {
  if (res.subtype === "success" && !res.isError) {
    finishSuccess(proc, res);
    return;
  }
  if (canRetryFresh(proc)) {
    proc.retryOnExit = true; // retry once the old process is gone
    proc.timers.push(setTimeout(() => killProc(proc), 2000));
    return;
  }
  finishError(proc, resultErrorMessage(proc, res));
}

function onSpawnError(proc: Proc, err: NodeJS.ErrnoException): void {
  if (proc.child?.pid) {
    console.warn("[kagaz] Claude Code process error:", err.message); // e.g. a failed kill(); not fatal
    return;
  }
  if (!proc.exited) {
    proc.exited = true;
    for (const t of proc.timers) clearTimeout(t);
    closeLogs(proc);
    proc.resolveExit();
  }
  if (proc.finished || proc.stopped || !isRunCurrent(proc.runId)) return;
  const message =
    err.code === "ENOENT"
      ? `Could not start Claude Code (${claudeBin()} not found on PATH). Install it, or rehearse with npm run dev:mock.`
      : `Could not start Claude Code: ${err.message}`;
  finishError(proc, message);
}

function onClose(proc: Proc, code: number | null, signal: NodeJS.Signals | null): void {
  const r = runner();
  if (!proc.exited) {
    proc.exited = true;
    for (const t of proc.timers) clearTimeout(t);
    closeLogs(proc);
    proc.resolveExit();
  }
  if (r.proc === proc) r.proc = null;
  if (proc.finished || proc.stopped || !isRunCurrent(proc.runId)) return;
  if (proc.retryOnExit || (!proc.reducer.result && canRetryFresh(proc))) {
    void retryFresh(proc);
    return;
  }
  const how = signal ? `was killed (${signal})` : `exited with code ${code}`;
  finishError(proc, stderrMessage(proc) ?? `Claude Code ${how} before finishing`);
}

function onTimeout(proc: Proc): void {
  if (proc.finished || proc.stopped || !isRunCurrent(proc.runId)) return;
  proc.stopped = true;
  killProc(proc);
  finishError(proc, `Timed out after ${formatDuration(timeoutMs())}`);
}

async function retryFresh(proc: Proc): Promise<void> {
  proc.finished = true;
  proc.reducer.settle();
  addFeed({ kind: "system", text: "Starting a fresh session…" });
  try {
    const sketch = await findSketch();
    await spawnClaude({
      runId: proc.runId,
      mode: "tweak",
      prompt: freshTweakPrompt(proc.tweakText ?? "", sketch?.name ?? null),
      resume: null,
      tweakText: proc.tweakText,
      retried: true,
    });
  } catch (err) {
    if (isRunCurrent(proc.runId)) failRun(proc.runId, (err as Error).message, false);
  }
}

// --- finishing ---------------------------------------------------------------------------------------

/** The CLI normally exits right after its result line; make sure a hung process doesn't linger. */
function reapLater(proc: Proc): void {
  proc.timers.push(
    setTimeout(() => {
      if (proc.exited) return;
      proc.stopped = true;
      killProc(proc);
    }, 10_000),
  );
}

function finishSuccess(proc: Proc, res: ResultInfo): void {
  const r = runner();
  proc.finished = true;
  proc.reducer.settle();
  reapLater(proc);
  const finishedAt = Date.now();
  const startedAt = getState().startedAt ?? finishedAt;
  const durationMs = finishedAt - startedAt;
  const summary = cleanSummary(res.text);
  const sessionId = res.sessionId ?? proc.reducer.sessionId ?? getState().sessionId;
  if (proc.mode === "tweak" && proc.tweakText) r.tweaks.push(proc.tweakText);
  if (proc.mode === "build") r.buildTitle = summary;
  update((s) => {
    s.status = "done";
    s.finishedAt = finishedAt;
    s.stats.durationMs = durationMs;
    s.stats.costUsd = res.costUsd;
    s.stats.turns = res.numTurns;
    s.summary = summary ?? s.summary;
    s.sessionId = sessionId;
    s.canTweak = true;
    s.error = null;
  });
  settleLiveFeed();
  addFeed({
    kind: "done",
    text: proc.mode === "tweak" ? `Tweak applied in ${seconds(durationMs)}` : `App ready in ${seconds(durationMs)}`,
  });
  console.log(`[kagaz] run ${proc.runId} done in ${seconds(durationMs)} (session ${sessionId ?? "?"})`);
  snapshotCurrent(proc.mode);
}

function finishError(proc: Proc, message: string): void {
  proc.finished = true;
  proc.reducer.settle();
  reapLater(proc);
  failRun(proc.runId, message, proc.reducer.touchedFiles);
}

function failRun(runId: number, message: string, touchedFiles: boolean): void {
  if (getState().runId !== runId) return;
  const finishedAt = Date.now();
  const error = truncate(message.replace(/\s+/g, " ").trim() || "Something went wrong", 300);
  update((s) => {
    s.status = "error";
    s.error = error;
    s.finishedAt = finishedAt;
    s.stats.durationMs = s.startedAt ? finishedAt - s.startedAt : null;
    s.canTweak = s.canTweak || touchedFiles;
  });
  settleLiveFeed();
  addFeed({ kind: "error", text: truncate(error, 160) });
  console.warn(`[kagaz] run ${runId} failed: ${error}`);
}

function snapshotCurrent(mode: RunMode): void {
  const r = runner();
  const s = getState();
  const title = (mode === "tweak" ? r.buildTitle : null) ?? s.summary ?? "Untitled app";
  const input = {
    title,
    durationMs: s.stats.durationMs,
    stats: { ...s.stats },
    mode,
    tweaks: [...r.tweaks],
    sessionId: s.sessionId,
    sketchName: s.sketch?.name ?? null,
  };
  r.snapshotting = r.snapshotting
    .then(() => saveSnapshot(input))
    .then((id) => console.log(`[kagaz] saved snapshots/${id}`))
    .catch((err) => console.error("[kagaz] snapshot failed:", err));
}

// --- public entry points -----------------------------------------------------------------------------

export interface BuildInput {
  data: Buffer;
  ext: ImageExt;
  name: string;
}

/** Starts a new build from a sketch photo. The timer starts now. Throws BusyError while a run is active. */
export async function startBuild(input: BuildInput): Promise<{ runId: number }> {
  assertIdle();
  const r = runner();
  const now = Date.now();
  let runId = 0;
  update((s) => {
    s.status = "running";
    s.mode = "build";
    s.runId += 1;
    runId = s.runId;
    s.startedAt = now;
    s.buildStartedAt = now;
    s.finishedAt = null;
    s.stats = emptyStats();
    s.summary = null;
    s.error = null;
    s.sessionId = null;
    s.canTweak = false;
  });
  resetFeed([{ kind: "system", text: `Sketch received: ${input.name}` }]);
  r.tweaks = [];
  r.buildTitle = null;
  try {
    await stopProcessAndWait();
    await r.snapshotting;
    if (!isRunCurrent(runId)) return { runId };
    await resetPlaygroundFiles();
    const sketchName = await writeSketch(input.data, input.ext);
    if (!isRunCurrent(runId)) return { runId };
    update((s) => {
      s.sketch = { url: `/api/sketch?v=${runId}`, name: input.name };
      s.previewVersion += 1;
    });
    await spawnClaude({
      runId,
      mode: "build",
      prompt: buildPrompt(sketchName),
      resume: null,
      tweakText: null,
      retried: false,
    });
  } catch (err) {
    if (isRunCurrent(runId)) failRun(runId, (err as Error).message, false);
    throw err;
  }
  return { runId };
}

export async function startBuildFromSample(id: string): Promise<{ runId: number }> {
  assertIdle();
  const sample = await getSample(id);
  if (!sample) throw new HttpError(404, `No sample sketch called "${id}"`);
  const data = await fs.promises.readFile(sample.file);
  return startBuild({ data, ext: sample.ext, name: sample.name });
}

/** Applies a follow-up change to the current app, resuming the build's Claude session when possible. */
export async function startTweak(rawText: string): Promise<{ runId: number }> {
  assertIdle();
  const before = getState();
  if (!before.canTweak) throw new HttpError(400, "Build an app first");
  const text = rawText.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!text) throw new HttpError(400, "Type the change you want first");
  const sessionId = before.sessionId;
  const now = Date.now();
  let runId = 0;
  update((s) => {
    s.status = "running";
    s.mode = "tweak";
    s.runId += 1;
    runId = s.runId;
    s.startedAt = now;
    s.finishedAt = null;
    s.stats = emptyStats();
    s.error = null;
  });
  addFeed({ kind: "user", text });
  try {
    await stopProcessAndWait();
    const sketch = await findSketch();
    await spawnClaude({
      runId,
      mode: "tweak",
      prompt: sessionId ? tweakPrompt(text) : freshTweakPrompt(text, sketch?.name ?? null),
      resume: sessionId,
      tweakText: text,
      retried: false,
    });
  } catch (err) {
    if (isRunCurrent(runId)) failRun(runId, (err as Error).message, false);
    throw err;
  }
  return { runId };
}

/** Stops the current run (SIGINT, then SIGTERM after 3 s). Resolves once the process exited (<= 4 s). */
export async function stopRun(waitMs = 0): Promise<{ stopped: boolean }> {
  const r = runner();
  const proc = r.proc;
  const state = getState();
  if (state.status !== "running") {
    if (proc && !proc.exited) await stopProcessAndWait(waitMs);
    return { stopped: false };
  }
  if (proc) {
    proc.stopped = true;
    proc.finished = true;
    proc.reducer.settle();
    killProc(proc);
  }
  const finishedAt = Date.now();
  const touched = proc?.reducer.touchedFiles ?? false;
  update((s) => {
    s.status = "stopped";
    s.finishedAt = finishedAt;
    s.stats.durationMs = s.startedAt ? finishedAt - s.startedAt : null;
    s.canTweak = s.canTweak || touched;
  });
  settleLiveFeed();
  addFeed({ kind: "system", text: "Stopped" });
  if (proc && waitMs > 0) {
    await Promise.race([proc.exitPromise, new Promise((resolve) => setTimeout(resolve, waitMs))]);
  }
  return { stopped: true };
}

/** Stop + restore playground/ to the committed template + clear the state. */
export async function resetAll(): Promise<void> {
  const r = runner();
  if (r.maintenance) throw new BusyError(`Hold on — ${r.maintenance}`);
  r.maintenance = "resetting the playground";
  try {
    await stopRun(4000);
    await stopProcessAndWait();
    await r.snapshotting;
    try {
      await resetPlaygroundFiles();
    } catch (err) {
      addFeed({ kind: "error", text: (err as Error).message });
      throw err;
    }
    r.tweaks = [];
    r.buildTitle = null;
    update((s) => {
      s.status = "idle";
      s.mode = null;
      s.sketch = null;
      s.sessionId = null;
      s.canTweak = false;
      s.stats = emptyStats();
      s.summary = null;
      s.error = null;
      s.startedAt = null;
      s.finishedAt = null;
      s.buildStartedAt = null;
      s.previewVersion += 1;
    });
    resetFeed([{ kind: "system", text: "Playground reset to the clean template" }]);
  } finally {
    r.maintenance = null;
  }
}

/** Puts a gallery snapshot back into the playground and makes it tweakable again. */
export async function restoreSnapshot(id: string): Promise<void> {
  assertIdle();
  const meta = await readSnapshot(id);
  if (!meta) throw new HttpError(404, "That gallery item no longer exists");
  const r = runner();
  r.maintenance = "restoring from the gallery";
  try {
    await stopProcessAndWait();
    await r.snapshotting;
    await resetPlaygroundFiles();
    const sketchFile = await copySnapshotToPlayground(id);
    r.tweaks = [...meta.tweaks];
    r.buildTitle = meta.title;
    const sketchName = meta.sketchName ?? meta.title;
    update((s) => {
      s.status = "done";
      s.mode = meta.mode;
      s.summary = meta.title;
      s.sessionId = meta.sessionId;
      s.canTweak = true;
      s.stats = { ...emptyStats(), ...meta.stats };
      s.startedAt = null;
      s.finishedAt = null;
      s.buildStartedAt = null;
      s.error = null;
      s.previewVersion += 1;
      s.sketch = sketchFile ? { url: `/api/sketch?v=${s.runId}-r${s.previewVersion}`, name: sketchName } : null;
    });
    resetFeed([{ kind: "system", text: `Restored “${truncate(meta.title, 100)}” from the gallery` }]);
  } finally {
    r.maintenance = null;
  }
}
