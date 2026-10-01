# Kagaz → App — plan

Paper sketch → photo → `claude -p` in `playground/` → Vite hot-reloads the new app into an iframe.
One command starts everything; one laptop, no cloud, no database.

## Layout (`kagaz-app/`)

| Path | What |
|---|---|
| `control/` | Next.js + TS + Tailwind stage screen and local API (`127.0.0.1:3000`) |
| `playground/` | Vite + React + TS + Tailwind template Claude edits (`localhost:5173`) |
| `samples/` | 3 hand-drawn sketches (todo, chai menu, calculator) as SVG source + PNG |
| `snapshots/` | Gallery of finished builds (gitignored, created at runtime) |
| `scripts/dev.mjs` | Starts both dev servers (`npm run dev`); `--mock` runs a fake Claude for rehearsal |
| `scripts/mock-claude.mjs` | Emits realistic `stream-json` and writes a canned app (no usage spent) |

## How a build runs

1. Upload (drag/drop, file picker, sample button, or phone page). Browser downsizes to ≤1600px JPEG.
2. Server: refuse if a run is active → `git checkout`/`git clean` `playground/` → save `playground/sketch.<ext>`
   → start the timer → spawn Claude in `playground/`:

   ```
   claude -p --output-format stream-json --verbose --include-partial-messages
          --model sonnet --effort medium
          --tools Read,Write,Edit,Glob,Grep --allowedTools Read,Write,Edit,Glob,Grep
          --permission-mode acceptEdits --permission-prompts none
          --strict-mcp-config --safe-mode --restricted --max-turns 40
          --append-system-prompt "<builder rules>"        (prompt goes in on stdin)
   ```

   Flags newer than the user's CLI are detected from `claude --help` and dropped if missing.
   `--safe-mode` skips CLAUDE.md/hooks/plugins; `--restricted` confines file tools to `playground/`.
3. Each stdout line is parsed: `stream_event` deltas give live "Writing App.tsx… 120 lines" and
   narration text; `assistant` tool_use blocks give Read/Write/Edit steps; `result` stops the timer,
   records `session_id`, cost, turns. Stats come from tool inputs (files created, lines written).
4. State lives in a `globalThis` singleton and is pushed to the browser over SSE (`/api/events`).
5. Tweak: `claude -p --resume <session_id>` with the follow-up text (falls back to a fresh run).
6. Success → snapshot `playground/src` + sketch into `snapshots/<id>/` for the gallery.

## API contract (control app)

Types: `control/lib/types.ts` (`KagazState`, `FeedItem`, `GalleryItem`, `PhoneInfo`, `SampleInfo`).

| Route | Purpose |
|---|---|
| `GET /api/events` | SSE; `event: state`, `data: KagazState` on connect and on every change |
| `GET /api/state` | Current `KagazState` |
| `POST /api/build` | multipart `file`, or JSON `{ "sample": "todo" }` → 202 / 409 busy |
| `POST /api/tweak` | JSON `{ "text": "make it dark mode" }` → 202 / 409 busy |
| `POST /api/stop` | Stop the current run |
| `POST /api/reset` | Stop + restore `playground/` to the template |
| `GET /api/sketch` | Current sketch image |
| `GET /api/samples`, `GET /api/samples/:id` | Sample list / image |
| `GET /api/gallery`, `GET /api/gallery/:id/sketch`, `POST /api/gallery/:id/restore` | Gallery |
| `GET /api/phone`, `POST /api/phone {enable}` | LAN upload page on/off + QR |

Phone page: in-process `node:http` server on `0.0.0.0:3001`, started only when enabled from the
stage screen, every request needs a random token that is only in the QR code.

## Order of work

1. Must-haves: template, samples, runner + SSE, stage UI (upload, feed, timer, tweak, reset), docs.
2. Test with the mock, then 1–2 real Claude runs with a sample sketch.
3. Nice-to-haves: phone QR upload, gallery, stats — then review and polish.
