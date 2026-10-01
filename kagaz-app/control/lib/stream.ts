// Turns Claude Code's `--output-format stream-json` lines into the stage feed + stats.
// One reducer per spawned CLI process. Defensive by design: unexpected shapes are ignored, never thrown.
import path from "node:path";
import { addFeed, getState, removeFeed, update, updateFeed } from "./store";
import type { FeedKind } from "./types";

export interface ResultInfo {
  subtype: string;
  isError: boolean;
  text: string | null;
  sessionId: string | null;
  durationMs: number | null;
  numTurns: number | null;
  costUsd: number | null;
}

type Json = Record<string, unknown>;

interface Block {
  type: string;
  itemId: number | null; // feed item for text / thinking blocks
  toolId: string | null;
  text: string; // pending (not yet newline-terminated) narration
}

interface ToolEntry {
  itemId: number;
  name: string;
  json: string; // accumulated input_json_delta
  pathShown: boolean;
  finalized: boolean;
  pathText?: string; // label decided once the file path is known ("Creating X…" / "Rewriting X…")
}

interface Contribution {
  name: string;
  path: string;
  lines: number;
  failed: boolean;
}

const MAX_LINE = 160;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Strip markdown decoration from one narration line. */
export function cleanLine(raw: string): string {
  let s = raw.replace(/\r/g, "").trim();
  if (/^([-=_*~`])\1{2,}$/.test(s)) return "";
  s = s.replace(/^#{1,6}\s*/, "").replace(/^>\s*/, "").replace(/^(?:[-*•+]|\d+[.)])\s+/, "");
  s = s.replace(/[*`]/g, "").replace(/\s+/g, " ").trim();
  return truncate(s, MAX_LINE);
}

export function countLines(s: string): number {
  if (!s) return 0;
  const parts = s.split("\n");
  return s.endsWith("\n") ? parts.length - 1 : parts.length;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function textOfToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (isObj(c) && typeof c.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function toolKind(name: string): FeedKind {
  if (name === "Read") return "read";
  if (name === "Write") return "write";
  if (name === "Edit" || name === "MultiEdit") return "edit";
  if (name === "Glob" || name === "Grep" || name === "LS") return "read";
  return "system";
}

function toolStartText(name: string): string {
  switch (name) {
    case "Read":
      return "Opening a file…";
    case "Write":
      return "Writing a file…";
    case "Edit":
    case "MultiEdit":
      return "Editing a file…";
    case "Glob":
    case "Grep":
    case "LS":
      return "Looking around the project…";
    default:
      return `Using ${name}…`;
  }
}

function toolPathText(name: string, filePath: string): string | null {
  const base = path.basename(filePath);
  switch (name) {
    case "Read":
      return /^sketch\.[a-z0-9]+$/i.test(base) ? "Reading sketch…" : `Reading ${base}…`;
    case "Write":
      return `Creating ${base}…`; // StreamReducer.pathLabel picks "Rewriting" for files that already exist
    case "Edit":
    case "MultiEdit":
      return `Editing ${base}…`;
    default:
      return null;
  }
}

const FILE_PATH_RE = /"file_path"\s*:\s*"((?:[^"\\]|\\.)*)"/;

function unescapeJsonString(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
}

/**
 * Approximate line count of a streaming Write/Edit body: the "\n" escapes after the body key (at least 1).
 * Never exceeds the exact count shown once the block is complete, so the number only ever climbs.
 */
function streamingLines(name: string, json: string): number | null {
  const key = name === "Write" ? '"content"' : '"new_string"';
  const at = json.indexOf(key);
  if (at === -1) return null;
  const body = json.slice(at + key.length);
  return Math.max(1, body.match(/\\n/g)?.length ?? 0);
}

export class StreamReducer {
  sessionId: string | null = null;
  result: ResultInfo | null = null;
  toolCalls = 0;
  /** True once a Write/Edit succeeded or is in flight (the playground probably changed). */
  touchedFiles = false;

  private blocks = new Map<number, Block>();
  private tools = new Map<string, ToolEntry>();
  private contributions = new Map<string, Contribution>();
  private erroredTools = new Set<string>();
  private streamedMessages = new Set<string>();
  private sawStreamEvents = false;
  private waitingItem: number | null = null; // "Thinking…" while we wait for the model
  private retryItem: number | null = null;

  /** Absolute paths that already exist (tweaks) or were written earlier in this run. */
  private readonly knownFiles: Set<string>;

  constructor(
    private readonly cwd: string,
    private readonly isCurrent: () => boolean,
    existingFiles: Iterable<string> = [],
  ) {
    this.knownFiles = new Set(existingFiles);
  }

  /** The feed label for a tool once its path is known; decided once per tool call. */
  private pathLabel(tool: ToolEntry, filePath: string): string | null {
    if (tool.pathText) return tool.pathText;
    let text = toolPathText(tool.name, filePath);
    if (tool.name === "Write") {
      const abs = this.abs(filePath);
      if (this.knownFiles.has(abs)) text = `Rewriting ${path.basename(filePath)}…`;
      this.knownFiles.add(abs);
    }
    if (text) tool.pathText = text;
    return text;
  }

  /** True once Claude started any tool call in this process. */
  get usedTools(): boolean {
    return this.tools.size > 0 || this.toolCalls > 0;
  }

  handle(ev: unknown): void {
    if (!this.isCurrent() || !isObj(ev)) return;
    if (ev.parent_tool_use_id != null) return; // subagent traffic
    try {
      switch (ev.type) {
        case "system":
          this.onSystem(ev);
          break;
        case "stream_event":
          if (isObj(ev.event)) this.onStreamEvent(ev.event);
          break;
        case "assistant":
          this.onAssistant(ev);
          break;
        case "user":
          this.onUser(ev);
          break;
        case "result":
          this.onResult(ev);
          break;
        case "rate_limit_event":
          this.onRateLimit(ev);
          break;
        default:
          break;
      }
    } catch (err) {
      console.error("[kagaz] stream reducer ignored an event:", err);
    }
  }

  /** Called when the run ends: drop "Thinking…", flush half-streamed narration. */
  settle(): void {
    this.clearWaiting();
    for (const block of this.blocks.values()) this.closeBlock(block);
    this.blocks.clear();
    this.settleRetry();
  }

  /** The "API busy — retrying" line stops spinning once the model answers. */
  private settleRetry(): void {
    if (this.retryItem == null) return;
    updateFeed(this.retryItem, { live: false });
    this.retryItem = null;
  }

  // --- plan usage -----------------------------------------------------------------------------------

  private onRateLimit(ev: Json): void {
    const info = isObj(ev.rate_limit_info) ? ev.rate_limit_info : null;
    if (!info) return;
    const windows = isObj(info.unifiedWindows) ? info.unifiedWindows : {};
    const util = (w: unknown) => {
      const u = isObj(w) ? num(w.utilization) : null;
      return u === null ? null : Math.min(Math.max(u, 0), 1);
    };
    const resetsAt = num(info.resetsAt);
    update((s) => {
      s.usage = {
        status: str(info.status),
        fiveHour: util(windows.five_hour),
        sevenDay: util(windows.seven_day),
        resetsAt: resetsAt === null ? null : resetsAt * 1000,
        at: Date.now(),
      };
    });
  }

  // --- system ---------------------------------------------------------------------------------------

  private onSystem(ev: Json): void {
    const subtype = str(ev.subtype) ?? "";
    if (subtype === "init") {
      const sessionId = str(ev.session_id);
      if (sessionId) {
        this.sessionId = sessionId;
        update((s) => {
          s.sessionId = sessionId;
        });
      }
      const model = str(ev.model);
      addFeed({ kind: "system", text: model ? `Claude Code is on it (${model})` : "Claude Code is on it" });
      this.showWaiting();
      return;
    }
    if (subtype === "api_retry") {
      const attempt = num(ev.attempt) ?? 1;
      const text = `API busy — retrying (attempt ${attempt})…`;
      if (this.retryItem !== null && getState().feed.some((f) => f.id === this.retryItem)) {
        updateFeed(this.retryItem, { text, live: true });
      } else {
        this.retryItem = addFeed({ kind: "system", text, live: true });
      }
      return;
    }
    if (/permission|denied|denial/i.test(subtype)) {
      const what = str(ev.tool_name) ?? str(ev.message) ?? str(ev.reason) ?? subtype;
      addFeed({ kind: "error", text: truncate(`Blocked: ${what}`, MAX_LINE) });
    }
  }

  // --- partial messages (--include-partial-messages) ------------------------------------------------

  private onStreamEvent(e: Json): void {
    this.sawStreamEvents = true;
    switch (e.type) {
      case "message_start": {
        for (const block of this.blocks.values()) this.closeBlock(block);
        this.blocks.clear();
        this.settleRetry();
        const id = isObj(e.message) ? str(e.message.id) : null;
        if (id) this.streamedMessages.add(id);
        break;
      }
      case "content_block_start": {
        const index = num(e.index) ?? 0;
        const cb = isObj(e.content_block) ? e.content_block : {};
        this.startBlock(index, cb);
        break;
      }
      case "content_block_delta": {
        const block = this.blocks.get(num(e.index) ?? 0);
        const delta = isObj(e.delta) ? e.delta : null;
        if (!block || !delta) break;
        if (delta.type === "text_delta" && typeof delta.text === "string") this.onTextDelta(block, delta.text);
        else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string")
          this.onJsonDelta(block, delta.partial_json);
        break;
      }
      case "content_block_stop": {
        const index = num(e.index) ?? 0;
        const block = this.blocks.get(index);
        if (block) {
          this.closeBlock(block);
          this.blocks.delete(index);
        }
        break;
      }
      default:
        break; // message_delta, message_stop, ping
    }
  }

  private startBlock(index: number, cb: Json): void {
    const type = str(cb.type) ?? "unknown";
    const block: Block = { type, itemId: null, toolId: null, text: "" };
    this.blocks.set(index, block);
    if (type === "thinking" || type === "redacted_thinking") {
      if (this.waitingItem != null) {
        block.itemId = this.waitingItem; // reuse: no flicker
        this.waitingItem = null;
      } else {
        block.itemId = addFeed({ kind: "thinking", text: "Thinking…", live: true });
      }
      return;
    }
    this.clearWaiting();
    if (type === "tool_use") {
      const id = str(cb.id);
      const name = str(cb.name) ?? "tool";
      if (!id) return;
      block.toolId = id;
      if (!this.tools.has(id)) this.createTool(id, name);
    }
  }

  private closeBlock(block: Block): void {
    if (block.type === "text") {
      this.commitLine(block, block.text);
      block.text = "";
    } else if (block.type === "thinking" || block.type === "redacted_thinking") {
      if (block.itemId != null) removeFeed(block.itemId);
      block.itemId = null;
    }
  }

  private onTextDelta(block: Block, text: string): void {
    if (block.type !== "text") return;
    block.text += text;
    const parts = block.text.split("\n");
    block.text = parts.pop() ?? "";
    for (const line of parts) this.commitLine(block, line);
    const partial = cleanLine(block.text);
    if (!partial) return;
    if (block.itemId == null) block.itemId = addFeed({ kind: "step", text: partial, live: true });
    else updateFeed(block.itemId, { text: partial });
  }

  private commitLine(block: Block, raw: string): void {
    const clean = cleanLine(raw);
    if (block.itemId != null) {
      if (clean) updateFeed(block.itemId, { text: clean, live: false });
      else removeFeed(block.itemId);
      block.itemId = null;
    } else if (clean) {
      addFeed({ kind: "step", text: clean });
    }
  }

  private onJsonDelta(block: Block, partial: string): void {
    if (!block.toolId) return;
    const tool = this.tools.get(block.toolId);
    if (!tool || tool.finalized) return;
    tool.json += partial;
    if (!tool.pathShown) {
      const m = FILE_PATH_RE.exec(tool.json);
      if (m) {
        const text = this.pathLabel(tool, unescapeJsonString(m[1]));
        if (text) updateFeed(tool.itemId, { text });
        tool.pathShown = true;
      }
    }
    if (tool.name === "Write" || tool.name === "Edit") {
      const n = streamingLines(tool.name, tool.json);
      if (n != null) {
        const lines = plural(n, "line");
        updateFeed(tool.itemId, { detail: tool.name === "Edit" ? `+${lines}` : lines });
      }
    }
  }

  // --- complete messages ------------------------------------------------------------------------------

  private onAssistant(ev: Json): void {
    const msg = isObj(ev.message) ? ev.message : null;
    if (!msg || !Array.isArray(msg.content)) return;
    this.settleRetry();
    const msgId = str(msg.id);
    // With --include-partial-messages the narration was already shown from the deltas.
    const textWasStreamed = this.sawStreamEvents || (msgId !== null && this.streamedMessages.has(msgId));
    for (const raw of msg.content) {
      if (!isObj(raw)) continue;
      if (raw.type === "text" && typeof raw.text === "string") {
        if (textWasStreamed) continue;
        this.clearWaiting();
        for (const line of raw.text.split("\n")) {
          const clean = cleanLine(line);
          if (clean) addFeed({ kind: "step", text: clean });
        }
      } else if (raw.type === "tool_use") {
        this.clearWaiting();
        this.finalizeTool(raw);
      }
    }
  }

  private createTool(id: string, name: string): ToolEntry {
    const itemId = addFeed({ kind: toolKind(name), text: toolStartText(name), live: true });
    const entry: ToolEntry = { itemId, name, json: "", pathShown: false, finalized: false };
    this.tools.set(id, entry);
    if (name === "Write" || name === "Edit" || name === "MultiEdit") this.touchedFiles = true;
    return entry;
  }

  private finalizeTool(block: Json): void {
    const id = str(block.id);
    const name = str(block.name) ?? "tool";
    if (!id) return;
    const tool = this.tools.get(id) ?? this.createTool(id, name);
    if (tool.finalized) return;
    tool.finalized = true;
    this.toolCalls += 1;

    const input = isObj(block.input) ? block.input : {};
    const filePath = str(input.file_path) ?? str(input.path);
    const patch: { text?: string; detail?: string } = {};
    if (filePath) {
      const text = this.pathLabel(tool, filePath);
      if (text) patch.text = text;
    }
    if (name === "Write" && filePath) {
      const lines = countLines(str(input.content) ?? "");
      patch.detail = plural(lines, "line");
      this.contributions.set(id, { name, path: this.abs(filePath), lines, failed: false });
    } else if ((name === "Edit" || name === "MultiEdit") && filePath) {
      let lines = countLines(str(input.new_string) ?? "");
      if (Array.isArray(input.edits)) {
        for (const e of input.edits) if (isObj(e)) lines += countLines(str(e.new_string) ?? "");
      }
      patch.detail = `+${plural(lines, "line")}`;
      this.contributions.set(id, { name: "Edit", path: this.abs(filePath), lines, failed: false });
    } else if (name === "Glob" || name === "Grep") {
      const pattern = str(input.pattern);
      if (pattern) patch.detail = truncate(pattern, 60);
    }
    updateFeed(tool.itemId, patch);
    this.recomputeStats();
  }

  private onUser(ev: Json): void {
    const msg = isObj(ev.message) ? ev.message : null;
    if (!msg || !Array.isArray(msg.content)) return;
    let sawResult = false;
    for (const c of msg.content) {
      if (!isObj(c) || c.type !== "tool_result") continue;
      sawResult = true;
      const id = str(c.tool_use_id);
      const tool = id ? this.tools.get(id) : undefined;
      if (tool) updateFeed(tool.itemId, { live: false });
      if (c.is_error === true) {
        if (id) this.erroredTools.add(id);
        const contribution = id ? this.contributions.get(id) : undefined;
        if (contribution) {
          contribution.failed = true;
          this.recomputeStats();
        }
        const text = textOfToolResult(c.content).replace(/<\/?tool_use_error>/g, "").replace(/\s+/g, " ").trim();
        addFeed({ kind: "error", text: truncate(text || "A tool call failed", 140) });
      }
    }
    if (sawResult) this.showWaiting();
  }

  private onResult(ev: Json): void {
    this.clearWaiting();
    const sessionId = str(ev.session_id);
    if (sessionId) this.sessionId = sessionId;
    const denials = Array.isArray(ev.permission_denials) ? ev.permission_denials : [];
    for (const d of denials) {
      if (!isObj(d)) continue;
      const toolUseId = str(d.tool_use_id);
      if (toolUseId && this.erroredTools.has(toolUseId)) continue;
      const input = isObj(d.tool_input) ? d.tool_input : {};
      const target = str(input.file_path) ?? str(input.command) ?? "";
      addFeed({
        kind: "error",
        text: truncate(`Blocked: ${str(d.tool_name) ?? "a tool"}${target ? ` ${target}` : ""}`, MAX_LINE),
      });
    }
    const text = str(ev.result);
    this.result = {
      subtype: str(ev.subtype) ?? "unknown",
      isError: ev.is_error === true,
      text: text && text.trim() ? text.trim() : null,
      sessionId: sessionId ?? this.sessionId,
      durationMs: num(ev.duration_ms),
      numTurns: num(ev.num_turns),
      costUsd: num(ev.total_cost_usd),
    };
  }

  // --- helpers ----------------------------------------------------------------------------------------

  private showWaiting(): void {
    if (this.waitingItem != null) return;
    this.waitingItem = addFeed({ kind: "thinking", text: "Thinking…", live: true });
  }

  private clearWaiting(): void {
    if (this.waitingItem == null) return;
    removeFeed(this.waitingItem);
    this.waitingItem = null;
  }

  private abs(p: string): string {
    return path.resolve(this.cwd, p);
  }

  private recomputeStats(): void {
    const written = new Set<string>();
    const edited = new Set<string>();
    let lines = 0;
    for (const c of this.contributions.values()) {
      if (c.failed) continue;
      if (c.name === "Write") written.add(c.path);
      else edited.add(c.path);
      lines += c.lines;
    }
    const filesEdited = [...edited].filter((p) => !written.has(p)).length;
    const toolCalls = this.toolCalls;
    update((s) => {
      s.stats.filesCreated = written.size;
      s.stats.filesEdited = filesEdited;
      s.stats.linesWritten = lines;
      s.stats.toolCalls = toolCalls;
    });
  }
}
