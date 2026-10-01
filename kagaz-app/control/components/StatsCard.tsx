"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { KagazState } from "@/lib/types";
import { IconSparkle, IconX } from "./icons";
import { formatDuration, runDurationMs } from "./util";

/** Ease a number up from 0 when the card appears. */
function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return value;
}

function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value).toLocaleString("en-US")}</>;
}

/** "Built by Claude Code" overlay shown on the preview when a run finishes. */
export function StatsCard({ state, onClose }: { state: KagazState; onClose: () => void }) {
  const { stats, mode, summary } = state;
  const duration = runDurationMs(state);
  const tweak = mode === "tweak";
  const files = tweak ? stats.filesCreated + stats.filesEdited : stats.filesCreated;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-5">
      <div
        role="status"
        className="pointer-events-auto w-full max-w-3xl animate-rise rounded-2xl border border-white/10 bg-[#0e1117]/90 p-5 text-zinc-100 shadow-2xl shadow-black/60 backdrop-blur-md"
      >
        <div className="flex items-center gap-2.5">
          <IconSparkle className="size-5 text-clay" />
          <span className="text-base font-semibold tracking-wide text-white">
            {tweak ? "Tweaked by Claude Code" : "Built by Claude Code"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss stats"
            className="focus-ring -mr-1 ml-auto rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <IconX className="size-5" />
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-4 gap-3">
          <Stat label={tweak ? "files changed" : "files created"} value={<CountUp value={files} />} />
          <Stat label="lines written" value={<CountUp value={stats.linesWritten} />} />
          <Stat label="time taken" value={duration != null ? formatDuration(duration) : "—"} />
          <Stat label="turns" value={stats.turns != null ? <CountUp value={stats.turns} /> : "—"} />
        </dl>
        {summary && <p className="mt-3.5 truncate text-[0.9375rem] text-zinc-400" title={summary}>{summary}</p>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    // dt before dd for valid markup; flex-col-reverse puts the number on top.
    <div className="flex flex-col-reverse rounded-xl bg-white/[0.04] px-4 py-3 ring-1 ring-inset ring-white/[0.06]">
      <dt className="mt-2 text-sm text-zinc-400">{label}</dt>
      <dd className="font-mono text-[2rem] font-semibold leading-none text-white tabular-nums">{value}</dd>
    </div>
  );
}
