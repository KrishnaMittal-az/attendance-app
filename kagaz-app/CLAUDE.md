<!--
NOTE FOR THE SKETCH-BUILDER RUN: if your working directory is `playground/`, this file is NOT
for you. You are the headless builder that turns a sketch into an app; ignore this brief and
follow only the prompt you were given. (The control app normally starts you with --safe-mode,
which skips CLAUDE.md files entirely; this note is a fallback for older Claude Code versions.)
-->

# Kagaz → App — project brief

You are building a hackathon demo called "Kagaz → App": a judge draws an app UI on paper, I snap a photo, and Claude Code turns it into a working web app live on screen in about a minute. Everything runs locally on my laptop. Work autonomously; only ask me if truly blocked.

## Start
Save this brief as CLAUDE.md, write a short PLAN.md, then build without waiting for approval.

## How it works
1. Control app (Next.js + TypeScript + Tailwind) at localhost:3000. This is the screen I show on stage.
2. A separate template in /playground: a minimal Vite + React + Tailwind app with dependencies pre-installed, running its own dev server on localhost:5173.
3. I upload a sketch photo. The server saves it into /playground and runs Claude Code headless (`claude -p`) with /playground as the working directory. The prompt asks Claude to build that UI as a working, interactive app with real state, clickable buttons, and sensible sample data.
4. Vite hot reload shows the app appearing live in a preview iframe while Claude writes files.

Check the Claude Code docs (headless mode / CLI reference) for the correct flags; don't guess. Use streaming JSON output so progress can be shown live. Allow only file read/write/edit tools and keep Claude confined to /playground. It uses my existing logged-in Claude Code (Team plan), so no API key.

## Must-have (build these first)
- Big, clean, stage-ready layout: left side shows the sketch photo and a live Claude activity feed; right side shows the live app preview iframe.
- Upload via drag-and-drop or file picker.
- Live activity feed: terminal style, streaming Claude's steps ("Reading sketch…", "Creating App.tsx…", "Adding cart logic…") via SSE from the local server.
- Big timer: "Kagaz se App: 47s", measured from upload to Claude finishing.
- Tweak box: I type a follow-up like "make it dark mode" or "add a delete button" and Claude edits the same app. Continue the previous session if the CLI supports it (check docs).
- Reset button that restores /playground to the clean template (e.g., git checkout of that folder).
- /samples folder with 3 ready sketch images as a fallback if the camera fails. Draw them yourself as SVG/PNG: a todo app, a chai shop menu, and a calculator.
- README with exact run steps, and a DEMO.md with a 2-minute stage script.

## Nice-to-have (only after the must-haves work end to end)
- A QR code on screen that opens an upload page on my phone over the same WiFi, so I can photograph the judge's sketch and it appears instantly.
- Gallery of past builds (save each finished app as a snapshot folder) with one-click restore.
- Small "Built by Claude Code" stats: files created, lines written, time taken.

## Rules
- Simple and reliable beats fancy. No database, no cloud, no deployment.
- Nothing is exposed outside localhost except the optional phone upload page.
- Test the full flow at least once with a sample sketch. Keep real Claude runs during testing to 2–3 max, since my plan has usage limits.
- Finish with a short summary and the exact commands to start everything.

## Repo layout note
This repository also contains an unrelated attendance app at the repo root. The whole Kagaz → App
demo lives in `kagaz-app/` (paths like /playground and /samples above mean `kagaz-app/playground`
and `kagaz-app/samples`). See PLAN.md for the architecture and API contract.
