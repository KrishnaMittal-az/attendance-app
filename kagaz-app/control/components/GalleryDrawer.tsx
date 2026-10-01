"use client";

import { useEffect, useState } from "react";
import type { GalleryItem } from "@/lib/types";
import { IconClock, IconGallery, IconImage, IconRestore, IconSpinner, IconX } from "./icons";
import { useToast } from "./Toasts";
import { api, asArray, cx, failureText, formatDuration, postJson, timeAgo } from "./util";

interface GalleryDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Changes when a run finishes, so an open drawer picks up the new snapshot. */
  refreshKey: string;
  running: boolean;
}

export function GalleryDrawer({ open, onClose, refreshKey, running }: GalleryDrawerProps) {
  const toast = useToast();
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api<unknown>("/api/gallery").then((r) => {
      if (cancelled) return;
      if (r.ok) {
        const list = asArray<GalleryItem>(r.data, "gallery", "snapshots");
        setItems([...list].sort((a, b) => b.createdAt - a.createdAt));
        setError(null);
      } else {
        setError(r.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, refreshKey]);

  if (!open) return null;

  const restore = async (item: GalleryItem) => {
    setRestoring(item.id);
    const r = await postJson(`/api/gallery/${encodeURIComponent(item.id)}/restore`);
    setRestoring(null);
    if (r.ok) {
      toast(`Restored “${item.title}”`, "success");
      onClose();
    } else {
      toast(failureText(r), "error");
    }
  };

  const now = Date.now();

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="gallery-title">
      <div className="absolute inset-0 animate-fade-in bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-[min(30rem,92vw)] animate-drawer flex-col border-l border-white/10 bg-[#0f1218] shadow-2xl shadow-black">
        <header className="flex h-19 shrink-0 items-center gap-3 border-b border-white/[0.07] px-6">
          <IconGallery className="size-5 text-zinc-400" />
          <h2 id="gallery-title" className="text-xl font-semibold text-white">
            Gallery
          </h2>
          {items && items.length > 0 && <span className="text-base text-zinc-500">{items.length} builds</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close gallery"
            className="focus-ring -mr-2 ml-auto rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <IconX className="size-5" />
          </button>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-5">
          {error ? (
            <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-[0.9375rem] text-red-200">{error}</p>
          ) : items === null ? (
            <p className="flex items-center gap-2 p-4 text-zinc-400">
              <IconSpinner className="size-5 animate-spin" /> Loading…
            </p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="grid size-14 place-items-center rounded-2xl bg-white/[0.05] text-zinc-500">
                <IconGallery className="size-7" />
              </span>
              <p className="mt-4 text-lg font-medium text-zinc-200">No builds yet</p>
              <p className="mt-1.5 max-w-xs text-[0.9375rem] leading-relaxed text-zinc-500">
                Every finished app is saved here automatically. Restore one with a single click.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 transition hover:border-white/15 hover:bg-white/[0.05]"
                >
                  <div className="grid h-24 w-32 shrink-0 place-items-center overflow-hidden rounded-xl bg-paper ring-1 ring-black/10">
                    {item.sketchUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.sketchUrl} alt="" loading="lazy" className="size-full object-contain p-1" />
                    ) : (
                      <IconImage className="size-7 text-ink/40" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start gap-2">
                      <p className="line-clamp-2 min-w-0 flex-1 text-base font-medium leading-snug text-white" title={item.title}>
                        {item.title || "Untitled app"}
                      </p>
                      <span
                        className={cx(
                          "shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider",
                          item.mode === "tweak" ? "bg-violet-400/15 text-violet-300" : "bg-clay/15 text-clay",
                        )}
                      >
                        {item.mode}
                      </span>
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
                      <IconClock className="size-3.5" />
                      {timeAgo(item.createdAt, now)}
                      {item.durationMs != null && <span>· {formatDuration(item.durationMs)}</span>}
                      {item.stats?.filesCreated > 0 && <span>· {item.stats.filesCreated} files</span>}
                    </p>
                    {item.tweaks?.length > 0 && (
                      <p className="mt-1 truncate text-sm text-zinc-500" title={item.tweaks.join(" → ")}>
                        + {item.tweaks.join(" → ")}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => void restore(item)}
                      disabled={running || restoring !== null}
                      title={running ? "Stop the current run first" : "Put this app back into the preview"}
                      className="focus-ring mt-auto flex h-9 w-fit items-center gap-1.5 self-end rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm font-medium text-zinc-100 transition hover:border-white/25 hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {restoring === item.id ? <IconSpinner className="size-4 animate-spin" /> : <IconRestore className="size-4" />}
                      Restore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
