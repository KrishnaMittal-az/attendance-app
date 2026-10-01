"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import type { KagazState, RunStatus } from "@/lib/types";
import { IconCheck, IconGallery, IconPhone, IconReset, IconStop, IconX, type IconProps } from "./icons";
import { Timer } from "./Timer";
import { cx } from "./util";

interface TopBarProps {
  state: KagazState;
  phoneEnabled: boolean;
  onStop: () => void;
  onReset: () => void;
  onOpenGallery: () => void;
  onOpenPhone: () => void;
}

export function TopBar({ state, phoneEnabled, onStop, onReset, onOpenGallery, onOpenPhone }: TopBarProps) {
  const running = state.status === "running";
  return (
    <header className="flex h-19 shrink-0 items-center gap-6 border-b border-white/[0.06] px-6">
      <Brand />

      <div className="flex min-w-0 flex-1 items-center justify-center gap-5">
        <Timer state={state} />
        <StatusPill status={state.status} />
      </div>

      <nav className="flex shrink-0 items-center gap-2" aria-label="Controls">
        {running && (
          <button
            type="button"
            onClick={onStop}
            className="focus-ring flex h-11 items-center gap-2 rounded-xl bg-red-500 px-4 text-base font-semibold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 active:scale-[0.98]"
          >
            <IconStop className="size-5" />
            Stop
          </button>
        )}
        <BarButton icon={IconGallery} label="Gallery" onClick={onOpenGallery} />
        <BarButton icon={IconPhone} label="Phone" onClick={onOpenPhone} badge={phoneEnabled} />
        <ResetButton onConfirm={onReset} />
      </nav>
    </header>
  );
}

function Brand() {
  return (
    <div className="shrink-0 select-none">
      <div className="flex items-center gap-2.5 text-[1.85rem] leading-none">
        <span className="inline-block -rotate-2 font-hand text-paper drop-shadow-[0_1px_0_rgba(0,0,0,0.4)]">Kagaz</span>
        <svg viewBox="0 0 32 16" className="h-4 w-8 text-clay" aria-hidden="true">
          <path d="M1 8.5c6-2 14-2.5 27-.5M22 2.5l7 5.6-7.4 5.4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-bold tracking-tight text-white">App</span>
        <span className="sr-only">: paper sketch to working app</span>
      </div>
      <p className="mt-1.5 hidden text-[0.8125rem] text-zinc-400 min-[1440px]:block">
        paper sketch → working app, live with Claude Code
      </p>
    </div>
  );
}

const STATUS: Record<RunStatus, { label: string; className: string }> = {
  idle: { label: "Idle", className: "bg-white/[0.05] text-zinc-300 ring-white/10" },
  running: { label: "Building…", className: "bg-amber-400/10 text-amber-200 ring-amber-400/30" },
  done: { label: "Done", className: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30" },
  error: { label: "Error", className: "bg-red-500/10 text-red-300 ring-red-400/35" },
  stopped: { label: "Stopped", className: "bg-white/[0.05] text-zinc-300 ring-white/15" },
};

export function StatusPill({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={cx(
        "inline-flex h-10 min-w-[8.5rem] shrink-0 items-center justify-center gap-2 rounded-full px-4 text-base font-semibold ring-1 ring-inset",
        s.className,
      )}
      aria-live="polite"
    >
      {status === "running" && (
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-amber-400" />
        </span>
      )}
      {status === "idle" && <span className="size-2.5 rounded-full bg-zinc-500" />}
      {status === "stopped" && <IconStop className="size-4" />}
      {status === "error" && <IconX className="size-4" strokeWidth={3} />}
      {s.label}
      {status === "done" && <IconCheck className="size-[1.1rem]" strokeWidth={3} />}
    </span>
  );
}

interface BarButtonProps {
  icon: ComponentType<IconProps>;
  label: string;
  onClick: () => void;
  badge?: boolean;
  active?: boolean;
}

function BarButton({ icon: Icon, label, onClick, badge, active }: BarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={active}
      className={cx(
        "focus-ring relative flex h-11 items-center gap-2 rounded-xl border px-3 text-base font-medium transition min-[1440px]:px-3.5",
        active
          ? "border-white/20 bg-white/[0.1] text-white"
          : "border-white/10 bg-white/[0.04] text-zinc-200 hover:border-white/20 hover:bg-white/[0.08] hover:text-white",
      )}
    >
      <Icon className="size-5" />
      <span className="hidden min-[1440px]:inline">{label}</span>
      {badge && <span className="absolute -right-1 -top-1 size-3 rounded-full bg-emerald-400 ring-2 ring-stage" aria-hidden="true" />}
    </button>
  );
}

/** Reset with an inline confirm popover (window.confirm looks bad on a projector). */
function ResetButton({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <BarButton icon={IconReset} label="Reset" onClick={() => setOpen((v) => !v)} active={open} />
      {open && (
        <div
          role="dialog"
          aria-label="Confirm reset"
          className="absolute right-0 top-full z-50 mt-2.5 w-80 origin-top-right animate-pop rounded-2xl border border-white/10 bg-raised p-5 shadow-2xl shadow-black/60"
        >
          <p className="text-lg font-semibold text-white">Reset the playground?</p>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
            Stops Claude and restores the clean template. Gallery snapshots are kept.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="focus-ring h-10 rounded-lg px-4 text-sm font-medium text-zinc-300 hover:bg-white/[0.08] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
              className="focus-ring h-10 rounded-lg bg-red-500 px-4 text-sm font-semibold text-white hover:bg-red-400"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
