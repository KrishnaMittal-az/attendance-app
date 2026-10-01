// How we invoke Claude Code headless: binary, flags (feature-detected from `claude --help`), env, prompts.
// Flags follow code.claude.com/docs/en/headless and /cli-reference.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mockScriptPath, rootDir } from "./paths";
import { configuredEffort, configuredModel, setCliVersion } from "./store";

export const ALLOWED_TOOLS = "Read,Write,Edit,Glob,Grep";
const DISALLOWED_TOOLS = "Bash,WebFetch,WebSearch,Task,Agent,NotebookEdit";

/** Optional flags we only pass when `claude --help` lists them (older CLIs reject unknown flags). */
const OPTIONAL_FLAGS = [
  "--include-partial-messages",
  "--effort",
  "--tools",
  "--permission-prompts",
  "--safe-mode",
  "--restricted",
  "--session-id",
] as const;

export interface CliFeatures {
  version: string | null;
  help: string;
  flags: Set<string>;
  mock: boolean;
}

const g = globalThis as typeof globalThis & { __kagazCli?: Promise<CliFeatures> };

export function isMock(): boolean {
  return process.env.KAGAZ_MOCK === "1";
}

export function claudeBin(): string {
  return process.env.KAGAZ_CLAUDE_BIN || "claude";
}

/** The executable plus the leading args (the mock runs as `node scripts/mock-claude.mjs …`). */
export function claudeCommand(): { cmd: string; prefix: string[] } {
  if (isMock()) return { cmd: process.execPath, prefix: [mockScriptPath()] };
  return { cmd: claudeBin(), prefix: [] };
}

/**
 * Child env: never look nested inside another Claude Code; use the logged-in subscription, not an API key;
 * and don't leak the Next.js dev server's own settings (NODE_ENV=development, Next internals, the
 * --max-old-space-size/--enable-source-maps it adds to NODE_OPTIONS) into the CLI.
 */
const DROP_ENV = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  // Set when the control app itself was started from inside a Claude Code session: the child would
  // otherwise reuse that session's id (and talk to its sockets) instead of starting its own.
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_PID",
  "NODE_ENV",
  "TURBOPACK",
  "NEXT_RUNTIME",
  "NEXT_DEPLOYMENT_ID",
]);

export function claudeEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || DROP_ENV.has(key)) continue;
    if (key.startsWith("__NEXT") || key.startsWith("NEXT_PRIVATE_")) continue;
    if (key === "ANTHROPIC_API_KEY" && process.env.KAGAZ_KEEP_API_KEY !== "1") continue;
    env[key] = value;
  }
  if (env.NODE_OPTIONS) {
    const rest = env.NODE_OPTIONS.replace(/--max-old-space-size=\d+|--enable-source-maps/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (rest) env.NODE_OPTIONS = rest;
    else delete env.NODE_OPTIONS;
  }
  return env as NodeJS.ProcessEnv;
}

function run(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  const { cmd, prefix } = claudeCommand();
  return new Promise((resolve) => {
    execFile(
      cmd,
      [...prefix, ...args],
      { cwd: rootDir(), env: claudeEnv(), timeout: 10_000, maxBuffer: 4 * 1024 * 1024, shell: false },
      (err, stdout) => resolve({ ok: !err, stdout: String(stdout ?? "") }),
    );
  });
}

function hasFlag(help: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s,|\\[(])${escaped}(?![\\w-])`, "m").test(help);
}

async function detect(): Promise<CliFeatures> {
  const mock = isMock();
  const [help, version] = await Promise.all([run(["--help"]), run(["--version"])]);
  const flags = new Set<string>();
  for (const flag of OPTIONAL_FLAGS) if (mock || hasFlag(help.stdout, flag)) flags.add(flag);
  const features: CliFeatures = {
    version: version.ok ? version.stdout.trim().split("\n")[0] || null : null,
    help: help.stdout,
    flags,
    mock,
  };
  if (!help.ok && !mock) throw Object.assign(new Error("claude --help failed"), { features });
  return features;
}

/** Runs `claude --help` / `--version` once (cached; a failed probe is retried next time). */
export function detectFeatures(): Promise<CliFeatures> {
  if (!g.__kagazCli) {
    g.__kagazCli = detect().then(
      (features) => {
        setCliVersion(features.version, features.flags.has("--effort"));
        const missing = OPTIONAL_FLAGS.filter((f) => !features.flags.has(f));
        console.log(
          `[kagaz] Claude Code ${features.version ?? "(unknown version)"}${features.mock ? " — MOCK" : ""}` +
            (missing.length ? `; not supported, skipped: ${missing.join(" ")}` : "; all optional flags supported"),
        );
        return features;
      },
      (err: Error & { features?: CliFeatures }) => {
        g.__kagazCli = undefined; // try again on the next run
        const features = err.features ?? { version: null, help: "", flags: new Set<string>(), mock: false };
        setCliVersion(null, false);
        console.warn(`[kagaz] Could not run \`${claudeBin()} --help\`; using only the basic flags.`);
        return features;
      },
    );
  }
  return g.__kagazCli;
}

/** All CLI args (the prompt itself goes to stdin, never as a positional arg: --tools etc. are variadic). */
export function buildArgs(features: CliFeatures, opts: { resume?: string | null }): string[] {
  const has = (flag: string) => features.flags.has(flag);
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (has("--include-partial-messages")) args.push("--include-partial-messages");
  const model = configuredModel();
  if (model) args.push("--model", model);
  const effort = configuredEffort();
  if (effort && has("--effort")) args.push("--effort", effort);
  if (has("--tools")) args.push("--tools", ALLOWED_TOOLS);
  else args.push("--disallowedTools", DISALLOWED_TOOLS);
  args.push("--allowedTools", ALLOWED_TOOLS);
  args.push("--permission-mode", "acceptEdits");
  if (has("--permission-prompts")) args.push("--permission-prompts", "none");
  args.push("--strict-mcp-config");
  if (has("--safe-mode")) args.push("--safe-mode");
  if (has("--restricted")) args.push("--restricted");
  const maxTurns = Number.parseInt(process.env.KAGAZ_MAX_TURNS ?? "", 10);
  args.push("--max-turns", String(Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 40));
  args.push("--append-system-prompt", BUILDER_RULES);
  if (opts.resume) args.push("--resume", opts.resume);
  // A new conversation gets its own id, so --resume later always finds *this* build.
  else if (has("--session-id")) args.push("--session-id", randomUUID());
  return args;
}

/** Printable command line for logs (system prompt abbreviated; the prompt is on stdin). */
export function describeCommand(cmd: string, args: string[]): string {
  const quote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  const shown = args.map((a) => (a === BUILDER_RULES ? "'<BUILDER_RULES>'" : quote(a)));
  return [quote(cmd), ...shown].join(" ");
}

// ---------------------------------------------------------------------------------------------------
// Prompts. BUILDER_RULES goes in --append-system-prompt for builds and tweaks; the prompt goes to stdin.

export const BUILDER_RULES = `You are the builder in "Kagaz → App", a live stage demo: a judge drew an app on paper and you turn the photo into a working web app while the audience watches the live preview update. Speed and a working result matter most.

Project facts (true; do not explore to confirm them):
- The working directory is a Vite + React 19 + TypeScript + Tailwind CSS v4 app. Dependencies are installed and the dev server is already running with hot reload.
- src/main.tsx renders the default export of src/App.tsx and imports src/index.css (which contains @import "tailwindcss";).
- Available: react, react-dom and Tailwind utility classes. Nothing else: you cannot install packages or run commands. Use emoji or inline SVG for icons.

Rules:
- Only create or change files inside src/. Never edit index.html, vite.config.ts, package.json, tsconfig.json or src/main.tsx. No tests, docs or README files.
- Every file must be complete, valid TSX. Create a component file before importing it, and double-check every import path and default/named export: a broken import blanks the live preview.
- Keep state in React (useState/useReducer). No localStorage, no fetch or network calls: use realistic in-memory sample data.
- Make it genuinely work: every button, input, checkbox and tab does something sensible (add, delete, toggle, edit, filter, compute totals…).
- Make it look polished and modern with Tailwind: clear hierarchy, generous spacing, rounded corners, soft shadows, hover and active states, responsive. It is shown in an iframe of about 900×800 px: fill it nicely (center narrow apps, use the full width for dashboards).
- Before each file write or edit, output one short line (max 7 words, no markdown) saying what you are doing, e.g. "Laying out the menu cards" or "Adding cart logic". No other commentary.
- When done, reply with exactly one sentence describing the app.`;

export function buildPrompt(sketch: string): string {
  return `Build the app drawn in the sketch photo ./${sketch}.

1. Read ./${sketch}. It is a phone photo of a paper drawing: it may be rotated, blurry or messy, and it may include handwritten notes or arrows that describe behaviour. Follow them.
2. Right away, write a quick first version of src/App.tsx: the static layout of the sketch with sample data, under 80 lines, so the live preview shows it within seconds.
3. Then write the complete, fully interactive app. Match the sketch's layout, sections, labels and wording (fix obvious spelling, infer anything illegible). Split it into a few components under src/components/ only if that helps; keep it to a handful of files.
4. Finish with one sentence describing the app.`;
}

export function tweakPrompt(text: string): string {
  return `Change request from the presenter: ${JSON.stringify(text)}
Apply it to the current app in src/. Read a file first if you do not have its latest content. Keep everything else working and follow the same rules as before. Finish with one sentence describing what changed.`;
}

export function freshTweakPrompt(text: string, sketch: string | null): string {
  const first = sketch ? `The app in src/ was generated from the sketch photo ./${sketch}. ` : "";
  return `${first}Change request from the presenter: ${JSON.stringify(text)}
Read src/App.tsx and the components it imports first, then apply the change. Keep everything else working. Finish with one sentence describing what changed.`;
}
