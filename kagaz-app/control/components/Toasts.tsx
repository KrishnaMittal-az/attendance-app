"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconInfo, IconX } from "./icons";
import { cx } from "./util";

export type ToastKind = "info" | "success" | "error";
type PushToast = (text: string, kind?: ToastKind) => void;

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const TOAST_MS = 4000;
const ToastContext = createContext<PushToast>(() => {});

/** const toast = useToast(); toast("Saved", "success") */
export function useToast(): PushToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<PushToast>(
    (text, kind = "info") => {
      const id = nextId.current++;
      // Same message twice in a row: replace it instead of stacking duplicates.
      setToasts((list) => [...list.filter((t) => t.text !== text), { id, kind, text }].slice(-4));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((timer) => clearTimeout(timer));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-5 top-24 z-[80] flex w-[min(26rem,calc(100vw-2.5rem))] flex-col gap-2.5" aria-live="polite">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const KIND_STYLE: Record<ToastKind, { ring: string; icon: string }> = {
  info: { ring: "border-white/12", icon: "text-zinc-300" },
  success: { ring: "border-emerald-400/30", icon: "text-emerald-300" },
  error: { ring: "border-red-400/40", icon: "text-red-300" },
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const style = KIND_STYLE[toast.kind];
  const Icon = toast.kind === "error" ? IconAlert : toast.kind === "success" ? IconCheck : IconInfo;
  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={cx(
        "pointer-events-auto flex animate-toast items-start gap-3 rounded-xl border bg-raised/95 px-4 py-3.5 shadow-2xl shadow-black/50 backdrop-blur",
        style.ring,
      )}
    >
      <Icon className={cx("mt-0.5 size-5 shrink-0", style.icon)} />
      <p className="min-w-0 flex-1 text-base leading-snug text-zinc-100">{toast.text}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="focus-ring -mr-1 rounded-md p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
      >
        <IconX className="size-4" />
      </button>
    </div>
  );
}
