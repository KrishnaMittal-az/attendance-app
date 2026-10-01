"use client";

import { useEffect, useState } from "react";
import type { KagazState } from "@/lib/types";
import { cx, formatDuration, timerMs } from "./util";

/** Re-renders every `intervalMs` while non-null; only this component ticks. */
function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs == null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const NUMBER_COLOR: Record<KagazState["status"], string> = {
  idle: "text-zinc-500",
  running: "text-white",
  done: "text-emerald-300",
  error: "text-red-300",
  stopped: "text-zinc-300",
};

/** "Kagaz se App: 47.2s" — measured from upload to Claude finishing. */
export function Timer({ state }: { state: KagazState }) {
  const running = state.status === "running";
  const now = useNow(running ? 100 : null);
  const label = state.mode === "tweak" ? "Tweak" : "Kagaz se App";

  return (
    <div className="flex items-baseline gap-3 whitespace-nowrap" role="timer" aria-label={label}>
      <span className="text-xl font-medium text-zinc-400">{label}:</span>
      <span
        className={cx(
          "min-w-[5.5ch] font-mono text-5xl font-semibold leading-none tracking-tight tabular-nums transition-colors duration-500",
          NUMBER_COLOR[state.status],
        )}
      >
        {formatDuration(timerMs(state, now))}
      </span>
    </div>
  );
}
