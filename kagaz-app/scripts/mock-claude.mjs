#!/usr/bin/env node
// Mock Claude Code CLI for rehearsals (`npm run dev:mock`) and tests. Plain Node ESM, no dependencies.
// It speaks the same `claude -p --output-format stream-json --verbose --include-partial-messages`
// protocol as the real CLI and really writes a polished todo app into the working directory, so the
// whole stage flow (feed, timer, live preview, tweak, gallery) can be rehearsed without using any plan.
//
//   KAGAZ_MOCK_SPEED=2         run twice as fast (any positive number)
//   KAGAZ_MOCK_FAIL_RESUME=1   fail every --resume like an unknown session (tests the fresh-session fallback)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);

const HELP = `Usage: claude [options] [command] [prompt]

Claude Code (mock) - fake CLI used by Kagaz → App for rehearsals. No API calls are made.

Options:
  -p, --print                          Print response and exit (useful for pipes)
  --output-format <format>             Output format (only with --print): "text", "json", or "stream-json"
  --verbose                            Override verbose mode setting from config
  --include-partial-messages           Include partial message chunks as they arrive (stream-json only)
  --model <model>                      Model for the current session
  --effort <level>                     Effort level for the current session (low, medium, high, max)
  --tools <tools...>                   Specify the list of available tools from the built-in set
  --allowedTools, --allowed-tools <tools...>        Tools to allow without prompting
  --disallowedTools, --disallowed-tools <tools...>  Tools to deny
  --permission-mode <mode>             Permission mode to use for the session
  --permission-prompts <mode>          How permission prompts are handled
  --strict-mcp-config                  Only use MCP servers from --mcp-config
  --safe-mode                          Skip CLAUDE.md, hooks, plugins, skills and MCP servers
  --restricted                         Confine file tools to the working directory
  --max-turns <turns>                  Maximum number of agentic turns
  --append-system-prompt <prompt>      Append a system prompt to the default system prompt
  -r, --resume [sessionId]             Resume a conversation by session ID
  --session-id <uuid>                  Use a specific session ID for the conversation
  -v, --version                        Output the version number
  -h, --help                           Display help for command
`;

if (argv.includes("--version") || argv.includes("-v")) {
  process.stdout.write("0.0.0-mock (Claude Code mock)\n");
  process.exit(0);
}
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}

process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
process.stdout.on("error", () => process.exit(0)); // reader went away

const speedEnv = Number(process.env.KAGAZ_MOCK_SPEED);
const SPEED = Number.isFinite(speedEnv) && speedEnv > 0 ? speedEnv : 1;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms / SPEED));

function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

const resumeId = argValue("--resume") ?? argValue("-r");
const modelArg = argValue("--model");
const MODEL = `mock-${modelArg ?? "default"}`;
const PARTIAL = argv.includes("--include-partial-messages");
const CWD = process.cwd();
const SESSION = resumeId ?? argValue("--session-id") ?? crypto.randomUUID();
const started = Date.now();
let turns = 0;

const uuid = () => crypto.randomUUID();
const shortId = (prefix) => `${prefix}${crypto.randomBytes(12).toString("hex")}`;

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function streamEvent(event) {
  if (!PARTIAL) return;
  emit({ type: "stream_event", event, session_id: SESSION, parent_tool_use_id: null, uuid: uuid() });
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** Splits text into chunks of a few words (like model tokens). */
function wordChunks(text, perChunk = 2) {
  const words = text.match(/\S+\s*|\s+/g) ?? [text];
  const out = [];
  for (let i = 0; i < words.length; i += perChunk) out.push(words.slice(i, i + perChunk).join(""));
  return out;
}

/** Splits a string into n roughly equal pieces. */
function pieces(s, n) {
  const size = Math.max(1, Math.ceil(s.length / n));
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

function lineCount(s) {
  return s.split("\n").length - (s.endsWith("\n") ? 1 : 0);
}

/**
 * One assistant API turn, streamed like the real CLI: stream_event deltas (with partial messages on),
 * then one "assistant" event per finished content block. Tool side effects run when their block is done.
 * Then the tool results come back as a "user" event.
 */
async function assistantTurn(blocks) {
  turns += 1;
  const msgId = shortId("msg_mock_");
  const base = { id: msgId, type: "message", role: "assistant", model: MODEL };
  streamEvent({
    type: "message_start",
    message: { ...base, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } },
  });
  const results = [];
  let outputTokens = 0;
  for (let index = 0; index < blocks.length; index++) {
    const b = blocks[index];
    let finished;
    if (b.type === "thinking") {
      streamEvent({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
      const chunks = wordChunks(b.text, 3);
      for (const c of chunks) {
        await sleep(b.ms / chunks.length);
        streamEvent({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: c } });
      }
      streamEvent({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: "bW9jaw==" } });
      finished = { type: "thinking", thinking: b.text, signature: "bW9jaw==" };
    } else if (b.type === "text") {
      streamEvent({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      const chunks = wordChunks(b.text, 1);
      for (const c of chunks) {
        await sleep(b.ms / chunks.length);
        streamEvent({ type: "content_block_delta", index, delta: { type: "text_delta", text: c } });
      }
      finished = { type: "text", text: b.text };
    } else {
      const id = shortId("toolu_mock_");
      streamEvent({ type: "content_block_start", index, content_block: { type: "tool_use", id, name: b.name, input: {} } });
      const json = JSON.stringify(b.input);
      const chunks = pieces(json, b.chunks ?? 4);
      for (const c of chunks) {
        await sleep(b.ms / chunks.length);
        streamEvent({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: c } });
      }
      finished = { type: "tool_use", id, name: b.name, input: b.input };
      results.push({ id, run: b.run });
    }
    streamEvent({ type: "content_block_stop", index });
    outputTokens += 40;
    emit({
      type: "assistant",
      message: { ...base, content: [finished], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: outputTokens } },
      parent_tool_use_id: null,
      session_id: SESSION,
      uuid: uuid(),
    });
    if (finished.type === "tool_use") results[results.length - 1].output = runTool(results[results.length - 1].run);
  }
  streamEvent({
    type: "message_delta",
    delta: { stop_reason: results.length ? "tool_use" : "end_turn", stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
  streamEvent({ type: "message_stop" });
  for (const r of results) {
    await sleep(250);
    const out = r.output ?? { content: "ok" };
    emit({
      type: "user",
      message: {
        role: "user",
        content: [{ tool_use_id: r.id, type: "tool_result", content: out.content, ...(out.isError ? { is_error: true } : {}) }],
      },
      parent_tool_use_id: null,
      session_id: SESSION,
      uuid: uuid(),
    });
  }
}

function runTool(run) {
  try {
    return run ? run() : { content: "ok" };
  } catch (err) {
    return { content: `<tool_use_error>${err.message}</tool_use_error>`, isError: true };
  }
}

function writeFile(rel, content) {
  const abs = path.join(CWD, rel);
  const existed = fs.existsSync(abs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return { content: existed ? `The file ${abs} has been updated successfully.` : `File created successfully at: ${abs}` };
}

function findSketch() {
  try {
    return fs.readdirSync(CWD).find((n) => /^sketch\.(jpe?g|png|webp|gif)$/i.test(n)) ?? null;
  } catch {
    return null;
  }
}

function result(text) {
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: Date.now() - started,
    duration_api_ms: Math.round((Date.now() - started) * 0.8),
    num_turns: turns,
    result: text,
    session_id: SESSION,
    total_cost_usd: 0,
    usage: { input_tokens: 4800, output_tokens: 2600, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    permission_denials: [],
    uuid: uuid(),
  });
}

// --- canned app ---------------------------------------------------------------------------------------

const TODO_ITEM_TSX = `import { useState } from "react";

export type Todo = { id: number; text: string; done: boolean };

type Props = {
  todo: Todo;
  dark: boolean;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onEdit: (id: number, text: string) => void;
};

export default function TodoItem({ todo, dark, onToggle, onDelete, onEdit }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.text);

  function save() {
    const text = draft.trim();
    if (text) onEdit(todo.id, text);
    else setDraft(todo.text);
    setEditing(false);
  }

  return (
    <li
      className={\`group flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md \${
        dark ? "border-slate-700 bg-slate-800/80" : "border-stone-200 bg-white hover:border-amber-200"
      }\`}
    >
      <button
        type="button"
        onClick={() => onToggle(todo.id)}
        aria-label={todo.done ? "Mark as not done" : "Mark as done"}
        className={\`flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition active:scale-90 \${
          todo.done
            ? "border-emerald-500 bg-emerald-500 text-white"
            : dark
              ? "border-slate-500 hover:border-emerald-400"
              : "border-stone-300 hover:border-emerald-500"
        }\`}
      >
        {todo.done && (
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 10.5l3.2 3.2L15 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(todo.text);
              setEditing(false);
            }
          }}
          className={\`min-w-0 flex-1 rounded-lg px-2 py-1 text-base outline-none ring-2 ring-amber-400 \${
            dark ? "bg-slate-900 text-slate-100" : "bg-amber-50 text-stone-800"
          }\`}
        />
      ) : (
        <span
          title="Double-click to edit"
          onDoubleClick={() => {
            setDraft(todo.text);
            setEditing(true);
          }}
          className={\`min-w-0 flex-1 cursor-text truncate text-base transition \${
            todo.done
              ? dark
                ? "text-slate-500 line-through"
                : "text-stone-400 line-through"
              : dark
                ? "text-slate-100"
                : "text-stone-800"
          }\`}
        >
          {todo.text}
        </span>
      )}

      <button
        type="button"
        onClick={() => onDelete(todo.id)}
        aria-label="Delete task"
        className={\`rounded-lg p-1.5 opacity-50 transition group-hover:opacity-100 active:scale-90 \${
          dark ? "text-slate-400 hover:bg-rose-500/15 hover:text-rose-400" : "text-stone-400 hover:bg-rose-50 hover:text-rose-500"
        }\`}
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path
            d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </li>
  );
}
`;

const APP_TSX = `import { useState, type FormEvent } from "react";
import TodoItem, { type Todo } from "./components/TodoItem";

// Theme switch: the tweak "make it dark mode" flips this.
const DARK: boolean = false;

type Filter = "all" | "active" | "done";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "done", label: "Done" },
];

const SAMPLE_TODOS: Todo[] = [
  { id: 1, text: "Buy milk and chai patti", done: false },
  { id: 2, text: "Print the hackathon slides", done: true },
  { id: 3, text: "Call Riya about the demo", done: false },
  { id: 4, text: "Book a cab to the venue", done: false },
];

export default function App() {
  const [todos, setTodos] = useState<Todo[]>(SAMPLE_TODOS);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const left = todos.filter((t) => !t.done).length;
  const doneCount = todos.length - left;
  const progress = todos.length ? Math.round((doneCount / todos.length) * 100) : 0;
  const counts: Record<Filter, number> = { all: todos.length, active: left, done: doneCount };
  const visible = todos.filter((t) => (filter === "all" ? true : filter === "active" ? !t.done : t.done));

  function addTodo(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setTodos((prev) => [...prev, { id: Date.now(), text, done: false }]);
    setDraft("");
    if (filter === "done") setFilter("all");
  }

  const toggle = (id: number) => setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: number) => setTodos((prev) => prev.filter((t) => t.id !== id));
  const edit = (id: number, text: string) => setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, text } : t)));
  const clearDone = () => setTodos((prev) => prev.filter((t) => !t.done));

  return (
    <main
      className={\`min-h-screen px-4 py-12 transition-colors sm:py-16 \${
        DARK ? "bg-slate-950 text-slate-100" : "bg-linear-to-b from-amber-50 to-stone-100 text-stone-800"
      }\`}
    >
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold tracking-widest text-amber-500 uppercase">Today</p>
            <h1 className="mt-1 text-4xl font-bold tracking-tight sm:text-5xl">My Tasks</h1>
          </div>
          <div className="text-right">
            <p className="text-4xl font-bold tabular-nums">{left}</p>
            <p className={\`text-sm \${DARK ? "text-slate-400" : "text-stone-500"}\`}>{left === 1 ? "task" : "tasks"} left</p>
          </div>
        </header>

        <div className={\`mb-6 h-2 overflow-hidden rounded-full \${DARK ? "bg-slate-800" : "bg-stone-200"}\`}>
          <div
            className="h-full rounded-full bg-linear-to-r from-amber-400 to-emerald-500 transition-all duration-500"
            style={{ width: \`\${progress}%\` }}
          />
        </div>

        <form
          onSubmit={addTodo}
          className={\`flex gap-2 rounded-2xl border p-2 shadow-lg \${
            DARK ? "border-slate-800 bg-slate-900 shadow-black/30" : "border-stone-200 bg-white shadow-amber-900/5"
          }\`}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a new task…"
            className={\`min-w-0 flex-1 bg-transparent px-3 py-2 text-base outline-none \${
              DARK ? "placeholder:text-slate-500" : "placeholder:text-stone-400"
            }\`}
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-xl bg-amber-500 px-5 py-2 font-semibold text-white shadow-sm transition hover:bg-amber-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add
          </button>
        </form>

        <nav className="mt-6 flex items-center justify-between gap-3">
          <div className={\`inline-flex rounded-xl p-1 \${DARK ? "bg-slate-800" : "bg-stone-200/70"}\`}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={\`rounded-lg px-4 py-1.5 text-sm font-medium transition \${
                  filter === f.id
                    ? DARK
                      ? "bg-slate-700 text-white shadow"
                      : "bg-white text-stone-900 shadow"
                    : DARK
                      ? "text-slate-400 hover:text-slate-200"
                      : "text-stone-500 hover:text-stone-800"
                }\`}
              >
                {f.label}
                <span className="ml-1.5 text-xs opacity-60">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={clearDone}
            disabled={doneCount === 0}
            className={\`text-sm font-medium transition hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40 \${
              DARK ? "text-slate-400" : "text-stone-500"
            }\`}
          >
            Clear done
          </button>
        </nav>

        <ul className="mt-4 space-y-2">
          {visible.map((t) => (
            <TodoItem key={t.id} todo={t} dark={DARK} onToggle={toggle} onDelete={remove} onEdit={edit} />
          ))}
        </ul>

        {visible.length === 0 && (
          <div
            className={\`mt-4 rounded-2xl border-2 border-dashed px-6 py-10 text-center \${
              DARK ? "border-slate-800 text-slate-500" : "border-stone-300 text-stone-400"
            }\`}
          >
            <p className="text-3xl">🎉</p>
            <p className="mt-2 font-medium">{filter === "done" ? "Nothing finished yet" : "All clear. Add a task above!"}</p>
          </div>
        )}

        <p className={\`mt-8 text-center text-xs \${DARK ? "text-slate-600" : "text-stone-400"}\`}>
          Double-click a task to edit it
        </p>
      </div>
    </main>
  );
}
`;

const DARK_OFF = "const DARK: boolean = false;";
const DARK_ON = "const DARK: boolean = true;";

// --- scenarios ----------------------------------------------------------------------------------------

async function build() {
  const sketch = findSketch();
  await sleep(300);
  await assistantTurn([
    {
      type: "thinking",
      ms: 1500,
      text: "The photo shows a hand-drawn todo list: a title, an input with an add button, filter tabs and a few checkbox rows. I'll read the sketch, then write the app.",
    },
    { type: "text", ms: 400, text: "Reading the sketch" },
    ...(sketch
      ? [
          {
            type: "tool_use",
            name: "Read",
            ms: 300,
            chunks: 3,
            input: { file_path: path.join(CWD, sketch) },
            run: () => {
              const ext = path.extname(sketch).slice(1).toLowerCase();
              const media = ext === "jpg" ? "jpeg" : ext;
              return { content: [{ type: "image", source: { type: "base64", media_type: `image/${media}`, data: "(omitted by the mock)" } }] };
            },
          },
        ]
      : []),
  ]);
  await sleep(1200);
  await assistantTurn([
    { type: "text", ms: 500, text: "Laying out the todo list" },
    {
      type: "tool_use",
      name: "Write",
      ms: 1500,
      chunks: 10,
      input: { file_path: path.join(CWD, "src/components/TodoItem.tsx"), content: TODO_ITEM_TSX },
      run: () => writeFile("src/components/TodoItem.tsx", TODO_ITEM_TSX),
    },
  ]);
  await sleep(800);
  await assistantTurn([
    { type: "text", ms: 500, text: "Adding add, toggle and delete logic" },
    {
      type: "tool_use",
      name: "Write",
      ms: 3000,
      chunks: 25,
      input: { file_path: path.join(CWD, "src/App.tsx"), content: APP_TSX },
      run: () => writeFile("src/App.tsx", APP_TSX),
    },
  ]);
  await sleep(700);
  const summary =
    "A todo app with an add box, done/undo checkboxes, delete buttons, double-click editing, All/Active/Done filter tabs and a live tasks-left counter.";
  await assistantTurn([{ type: "text", ms: 600, text: summary }]);
  await sleep(200);
  result(summary);
}

async function tweak(prompt) {
  const m = /Change request from the presenter: (".*")/.exec(prompt);
  let request = "make a change";
  try {
    if (m) request = JSON.parse(m[1]);
  } catch {
    /* keep default */
  }
  const appRel = "src/App.tsx";
  const appAbs = path.join(CWD, appRel);
  const current = fs.existsSync(appAbs) ? fs.readFileSync(appAbs, "utf8") : "";
  const goingDark = !current.includes(DARK_ON);
  const theme = goingDark ? "dark" : "light";

  await sleep(300);
  await assistantTurn([
    { type: "thinking", ms: 800, text: `The presenter asked: ${request}. I'll update the theme in App.tsx.` },
    { type: "text", ms: 300, text: "Checking the current app" },
    {
      type: "tool_use",
      name: "Read",
      ms: 200,
      chunks: 2,
      input: { file_path: appAbs },
      run: () => ({ content: current ? current.split("\n").map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join("\n") : "File does not exist." }),
    },
  ]);
  await sleep(700);
  if (current.includes(DARK_OFF) || current.includes(DARK_ON)) {
    const oldString = goingDark ? DARK_OFF : DARK_ON;
    const newString = goingDark ? DARK_ON : DARK_OFF;
    await assistantTurn([
      { type: "text", ms: 400, text: `Switching to a ${theme} theme` },
      {
        type: "tool_use",
        name: "Edit",
        ms: 600,
        chunks: 4,
        input: { file_path: appAbs, old_string: oldString, new_string: newString },
        run: () => {
          const now = fs.readFileSync(appAbs, "utf8");
          if (!now.includes(oldString)) throw new Error("String to replace not found in file.");
          fs.writeFileSync(appAbs, now.replace(oldString, newString));
          return { content: `The file ${appAbs} has been updated successfully.` };
        },
      },
    ]);
  } else {
    // Not the mock's app (e.g. restored from a real build): write the mock app in the new theme.
    const app = goingDark ? APP_TSX.replace(DARK_OFF, DARK_ON) : APP_TSX;
    await assistantTurn([
      { type: "text", ms: 400, text: `Rebuilding the app with a ${theme} theme` },
      {
        type: "tool_use",
        name: "Write",
        ms: 800,
        chunks: 6,
        input: { file_path: path.join(CWD, "src/components/TodoItem.tsx"), content: TODO_ITEM_TSX },
        run: () => writeFile("src/components/TodoItem.tsx", TODO_ITEM_TSX),
      },
      {
        type: "tool_use",
        name: "Write",
        ms: 1500,
        chunks: 12,
        input: { file_path: appAbs, content: app },
        run: () => writeFile(appRel, app),
      },
    ]);
  }
  await sleep(500);
  const summary = `Switched the todo app to a ${theme} theme (request: “${request}”).`;
  await assistantTurn([{ type: "text", ms: 400, text: summary }]);
  await sleep(150);
  result(summary);
}

async function main() {
  const prompt = await readStdin();
  if (resumeId && process.env.KAGAZ_MOCK_FAIL_RESUME === "1") {
    await sleep(300);
    process.stderr.write(`No conversation found with session ID: ${resumeId}\n`);
    process.exitCode = 1;
    return;
  }
  await sleep(600); // CLI start-up
  emit({
    type: "system",
    subtype: "init",
    cwd: CWD,
    session_id: SESSION,
    tools: ["Read", "Write", "Edit", "Glob", "Grep"],
    mcp_servers: [],
    model: MODEL,
    permissionMode: argValue("--permission-mode") ?? "default",
    slash_commands: [],
    apiKeySource: "none",
    claude_code_version: "0.0.0-mock",
    output_style: "default",
    agents: [],
    skills: [],
    plugins: [],
    uuid: uuid(),
  });
  if (prompt.includes("Change request")) await tweak(prompt);
  else await build();
  process.exitCode = 0;
}

main().catch((err) => {
  process.stderr.write(`mock-claude crashed: ${err?.stack ?? err}\n`);
  process.exitCode = 1;
});
