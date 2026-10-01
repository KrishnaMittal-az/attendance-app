"use client";

import { useState } from "react";
import type { KagazState } from "@/lib/types";
import { IconExternal, IconGlobe, IconReload, IconSparkle } from "./icons";
import { StatsCard } from "./StatsCard";
import { formatDuration, previewHost, runDurationMs } from "./util";

/** Live preview of the playground app in a browser-chrome frame. */
export function PreviewPanel({ state }: { state: KagazState }) {
  const [reloads, setReloads] = useState(0);
  const [dismissedRun, setDismissedRun] = useState<number | null>(null);

  const url = state.config.previewUrl;
  const running = state.status === "running";
  const done = state.status === "done";
  const showStats = done && dismissedRun !== state.runId;
  const duration = runDurationMs(state);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <section
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-panel shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)]"
        aria-label="Live app preview"
      >
        {running && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[3px] overflow-hidden bg-clay/15">
            <div className="h-full w-1/3 animate-progress bg-linear-to-r from-transparent via-clay to-paper" />
          </div>
        )}

        {/* Browser chrome */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
          <span className="flex gap-2" aria-hidden="true">
            <i className="size-3 rounded-full bg-white/15" />
            <i className="size-3 rounded-full bg-white/15" />
            <i className="size-3 rounded-full bg-white/15" />
          </span>

          <div className="mx-auto flex h-8 w-full min-w-0 max-w-md items-center gap-2 rounded-lg bg-black/35 px-3 font-mono text-sm text-zinc-300 ring-1 ring-inset ring-white/[0.06]">
            <IconGlobe className="size-4 shrink-0 text-zinc-500" />
            <span className="truncate">{previewHost(url)}</span>
            {running && (
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-clay">
                <span className="size-1.5 animate-pulse rounded-full bg-clay" />
                live
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {done && !showStats && (
              <button
                type="button"
                onClick={() => setDismissedRun(null)}
                title="Show build stats"
                className="focus-ring mr-1 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-emerald-300 hover:bg-white/[0.08]"
              >
                <IconSparkle className="size-4" />
                {duration != null ? formatDuration(duration) : "Stats"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setReloads((n) => n + 1)}
              title="Reload preview"
              aria-label="Reload preview"
              className="focus-ring grid size-9 place-items-center rounded-lg text-zinc-400 hover:bg-white/[0.08] hover:text-white"
            >
              <IconReload className="size-[1.1rem]" />
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title="Open in a new tab"
              aria-label="Open preview in a new tab"
              className="focus-ring grid size-9 place-items-center rounded-lg text-zinc-400 hover:bg-white/[0.08] hover:text-white"
            >
              <IconExternal className="size-[1.1rem]" />
            </a>
          </div>
        </div>

        {/* Viewport */}
        <div className="relative min-h-0 flex-1 bg-white">
          <iframe
            key={`${state.previewVersion}-${reloads}`}
            src={url}
            title="Live app preview"
            className="absolute inset-0 size-full border-0 bg-white"
          />
          {running && (
            <div className="pointer-events-none absolute right-4 top-4 z-10 flex animate-fade-in items-center gap-2.5 rounded-full bg-black/80 py-2 pl-3 pr-4 text-[0.9375rem] font-medium text-white shadow-xl shadow-black/30 ring-1 ring-white/10 backdrop-blur">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
              </span>
              Claude is building… <span className="text-zinc-400">live</span>
            </div>
          )}
          {showStats && <StatsCard key={state.runId} state={state} onClose={() => setDismissedRun(state.runId)} />}
        </div>
      </section>

      {/* One-shot glow when a run finishes (keyed so it replays per run, not per update). */}
      {done && <div key={state.runId} className="pointer-events-none absolute inset-0 animate-glow rounded-2xl" />}
    </div>
  );
}
