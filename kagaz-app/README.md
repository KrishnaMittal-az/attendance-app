# Kagaz → App

A judge draws an app on paper. You snap a photo. Claude Code turns it into a working web app, live on
screen, in under a minute. (*Kagaz* means paper.)

```
 photo ─▶ control app (Next.js, :3000) ─▶ claude -p in playground/ ─▶ Vite hot reload (:5173) ─▶ iframe
             │  stage screen: sketch, live Claude feed (SSE), timer, tweak box, preview, gallery
             └─ optional phone upload page (:3001, LAN, secret token in a QR code)
```

Everything runs on your laptop: no database, no cloud, no deploy. Claude runs on your logged-in
Claude Code subscription, not an API key.

## What you need

- **macOS or Linux** (Windows works with the native `claude.exe` install, but isn't tested)
- **Node.js 20.19+** (22 LTS recommended) and **git**
- **Claude Code**, installed and logged in:
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash     # or: npm install -g @anthropic-ai/claude-code
  claude                                             # once, then /login with your Team account
  claude auth status                                 # should say "loggedIn": true
  ```
- Chrome for the stage screen

## Run it

```bash
git clone https://github.com/KrishnaMittal-az/attendance-app.git
cd attendance-app
git checkout claude/kagaz-app-hackathon-utprfo
cd kagaz-app
npm run setup        # installs control/ and playground/ dependencies (once)
npm run dev          # starts the stage screen and the live preview
```

Open **http://localhost:3000** and go full screen. `Ctrl+C` stops both servers.

**Rehearse without using your plan:** `npm run dev:mock` runs a fake Claude. It always builds the same
todo app, in about 13 seconds, with the same feed, timer and preview. The feed header shows **MOCK**.

> The repo root also holds an unrelated attendance app; everything for this demo is in `kagaz-app/`.
> Reset depends on git, so keep `playground/` committed (it is on this branch).

## Using it

| Action | How |
|---|---|
| Build from a photo | Drag a photo anywhere onto the screen, click the dropzone, or paste an image. It's downscaled to ≤1600 px in the browser first. |
| Fallback sketches | **Try a sample**: Todo app · Chai shop menu · Calculator (from `samples/`) |
| Phone upload | **Phone → Enable phone upload**, then scan the QR code on the same Wi-Fi. The photo goes straight onto the stage screen and the build starts. |
| Change the app | Type in the tweak box (e.g. *make it dark mode*) or tap a chip. The same Claude session is continued with `--resume`. |
| Stop a run | **Stop** (top bar, only while building) |
| Start over | **Reset** restores `playground/` to the clean template (`git checkout` + `git clean` of that folder). The gallery is kept. |
| Past builds | **Gallery**: every successful build and tweak is saved in `snapshots/`, and **Restore** puts it back in one click. You can keep tweaking a restored build. |

The **timer** runs from the moment the upload arrives until Claude finishes. The **Built by Claude Code**
card shows files created, lines written, time taken and turns. It tucks itself away after 12 s or when
you click into the app; the duration pill in the preview bar brings it back. The feed header shows your
plan usage for the 5-hour window when Claude Code reports it.

## How it works

On every build the server:

1. refuses if Claude is already running (HTTP 409);
2. resets `playground/` with git and saves the photo as `playground/sketch.<ext>`;
3. spawns Claude Code in `playground/`, writing the prompt to stdin:

```bash
claude -p --output-format stream-json --verbose --include-partial-messages \
  --model sonnet --effort medium \
  --tools Read,Write,Edit,Glob,Grep --allowedTools Read,Write,Edit,Glob,Grep \
  --permission-mode acceptEdits --permission-prompts none \
  --strict-mcp-config --safe-mode --restricted --max-turns 40 \
  --session-id <new uuid> --append-system-prompt "<builder rules>"
# tweaks: same flags, with --resume <session id> instead of --session-id
```

Flags follow the [headless docs](https://code.claude.com/docs/en/headless) and
[CLI reference](https://code.claude.com/docs/en/cli-reference). Newer flags are only passed if
`claude --help` lists them, so older CLIs still work. What they do:

- `--tools` leaves Claude with only file read/write/edit/search tools: no Bash, no web, no MCP
  (`--strict-mcp-config`).
- `--restricted` confines those tools to `playground/` and ignores your settings files.
- `--safe-mode` skips CLAUDE.md files, hooks, plugins and skills, so nothing from this repo or your
  `~/.claude` leaks in.
- `--permission-mode acceptEdits` lets it write files without asking, and `--permission-prompts none`
  denies everything else instead of waiting for an answer.

Each `stream-json` line is parsed into the feed: partial messages give the live "Creating App.tsx…
120 lines" counter and Claude's one-line narration; `tool_use` blocks give the steps; the `result`
message stops the timer and gives the session id, turns and cost. State lives in memory on the server
and is pushed to the browser over Server-Sent Events (`/api/events`). Vite's hot reload does the rest.

The child process gets your environment minus `ANTHROPIC_API_KEY` (so it uses your subscription;
set `KAGAZ_KEEP_API_KEY=1` to keep it) and minus any parent Claude Code session variables.

### What is reachable from the network

| Port | Bound to | What |
|---|---|---|
| 3000 | `127.0.0.1` | Stage screen + API. Mutating requests from other origins/hosts are rejected (403). |
| 5173 | `localhost` | Vite live preview |
| 3001 | `0.0.0.0`, **only after you enable Phone upload** | Upload page. Every request needs the random token from the QR code (new token each time you enable it). Images only, ≤15 MB. |

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `KAGAZ_MODEL` | `sonnet` | `--model` (`opus`, a full model id, or `default` to use your CLI default) |
| `KAGAZ_EFFORT` | `medium` | `--effort` (`low` is faster; `default` omits the flag) |
| `KAGAZ_MAX_TURNS` | `40` | `--max-turns` |
| `KAGAZ_TIMEOUT_MS` | `300000` | Stop a run after 5 minutes |
| `KAGAZ_CLAUDE_BIN` | `claude` | Path to the Claude Code binary |
| `KAGAZ_PHONE_PORT` | `3001` | Phone upload port |
| `KAGAZ_LAN_IP` | auto | IP shown in the QR code, if auto-detection picks the wrong network |
| `KAGAZ_PREVIEW_URL` | `http://localhost:5173` | Preview iframe URL |
| `KAGAZ_MOCK` | unset | `1` = fake Claude (same as `npm run dev:mock`); `KAGAZ_MOCK_SPEED=2` runs it twice as fast |

Example: `KAGAZ_MODEL=opus KAGAZ_EFFORT=high npm run dev` (better apps, slower builds).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Red banner "Claude Code CLI not found" | Install Claude Code, check that `claude --version` works in the same terminal, or set `KAGAZ_CLAUDE_BIN`. |
| Build errors with "not logged in" or a usage limit | Run `claude`, then `/login`. Check the plan % in the feed header. Restore a gallery build meanwhile. |
| "Reset needs git…" | Run from a git checkout with `playground/` committed. `npm run reset` does the same reset from a terminal. |
| `Port 5173 is in use` / `3000 in use` | Another dev server is still running: `lsof -i :5173` (or `:3000`) and kill it. |
| Preview blank or a red Vite error | Press the preview's reload button. If it stays broken, tweak: *fix the error so the app renders*. |
| Phone can't open the QR link | The phone must be on the same Wi-Fi. Many venue networks isolate devices: use your phone's hotspot. On macOS, allow incoming connections for `node`. With several networks, set `KAGAZ_LAN_IP`. |
| iPhone HEIC photos | The phone page and Safari convert to JPEG automatically. On desktop Chrome, export HEIC to JPEG first. |
| What did Claude actually do? | `.kagaz/last-run.jsonl` (raw stream), `.kagaz/last-run.stderr.log` and `.kagaz/last-run.cmd.txt` (exact command) |

## Project layout

```
kagaz-app/
├─ control/            Next.js stage screen + API (lib/ = runner, stream parser, state, gallery, phone)
├─ playground/         Vite + React + Tailwind template that Claude rewrites (reset = git checkout)
├─ samples/            todo / chai-menu / calculator sketches (.svg source + .png)
├─ scripts/dev.mjs     starts both dev servers (--mock for the fake Claude)
├─ scripts/mock-claude.mjs
├─ snapshots/          gallery (created at runtime, gitignored)
├─ .kagaz/             logs of the last run (gitignored)
├─ CLAUDE.md  PLAN.md  DEMO.md (2-minute stage script)
```
