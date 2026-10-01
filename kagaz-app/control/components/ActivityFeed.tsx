"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type { FeedItem, FeedKind, KagazState } from "@/lib/types";
import {
  IconAlert,
  IconArrowDown,
  IconArrowRight,
  IconCheck,
  IconChevron,
  IconDot,
  IconEye,
  IconFilePlus,
  IconPencil,
  IconSparkle,
  type IconProps,
} from "./icons";
import { cx, formatOffset } from "./util";

const KIND: Record<FeedKind, { icon: ComponentType<IconProps>; iconClass: string; textClass: string }> = {
  system: { icon: IconDot, iconClass: "text-zinc-500", textClass: "text-zinc-400" },
  user: { icon: IconChevron, iconClass: "text-amber-400", textClass: "text-amber-200 font-semibold" },
  read: { icon: IconEye, iconClass: "text-cyan-400", textClass: "text-zinc-100" },
  write: { icon: IconFilePlus, iconClass: "text-emerald-400", textClass: "text-zinc-100" },
  edit: { icon: IconPencil, iconClass: "text-yellow-300", textClass: "text-zinc-100" },
  step: { icon: IconArrowRight, iconClass: "text-zinc-200", textClass: "text-white" },
  thinking: { icon: IconSparkle, iconClass: "text-zinc-600", textClass: "text-zinc-500 italic" },
  done: { icon: IconCheck, iconClass: "text-emerald-400", textClass: "text-emerald-300 font-semibold" },
  error: { icon: IconAlert, iconClass: "text-red-400", textClass: "text-red-300" },
};

/**
 * Offset of each item from the start of the run it belongs to: the current run
 * uses state.startedAt; earlier segments use the build start or the tweak's
 * "user" line, so old lines never show negative times.
 */
function feedOffsets(feed: FeedItem[], startedAt: number | null, buildStartedAt: number | null): (number | null)[] {
  let segmentStart = buildStartedAt ?? startedAt ?? feed[0]?.at ?? null;
  return feed.map((item) => {
    if (item.kind === "user") segmentStart = item.at;
    const base = startedAt != null && item.at >= startedAt ? startedAt : segmentStart;
    return base == null ? null : item.at - base;
  });
}

export function ActivityFeed({ state }: { state: KagazState }) {
  const { feed, config } = state;
  const running = state.status === "running";
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const userScrollAt = useRef(0);
  const [stuck, setStuck] = useState(true);

  const offsets = useMemo(
    () => feedOffsets(feed, state.startedAt, state.buildStartedAt),
    [feed, state.startedAt, state.buildStartedAt],
  );

  // A new run always follows the latest line again (declared first so it runs first).
  useLayoutEffect(() => {
    stickRef.current = true;
    setStuck(true);
  }, [state.runId]);

  // Follow new lines unless the presenter scrolled up to read something.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [feed]);

  // Stay pinned when the box itself resizes (sketch panel grows, window resizes,
  // a long line wraps) — no new feed item arrives in those cases.
  const hasItems = feed.length > 0;
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    observer.observe(content);
    return () => observer.disconnect();
  }, [hasItems]);

  // Only a real user gesture can un-stick the feed. Our own scrollTop writes also
  // fire scroll events, sometimes after a reflow (web fonts loading, lines
  // wrapping) has already made the box taller, which would look like "not at bottom".
  const markUserScroll = () => {
    userScrollAt.current = Date.now();
  };
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom) {
      stickRef.current = true;
      setStuck(true);
    } else if (Date.now() - userScrollAt.current < 1000) {
      stickRef.current = false;
      setStuck(false);
    }
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setStuck(true);
    el.scrollTop = el.scrollHeight;
  };

  const model = [config.model ?? "default model", config.effort].filter(Boolean).join(" · ");
  const usage = state.usage;
  const usagePct = usage?.fiveHour != null ? Math.round(usage.fiveHour * 100) : null;
  const usageLimited = usage?.status != null && usage.status !== "allowed";

  return (
    <section
      className="relative flex min-h-40 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-term shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]"
      aria-label="Claude activity"
    >
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4">
        <span className="flex gap-2" aria-hidden="true">
          <i className="size-3 rounded-full bg-[#ff5f57]" />
          <i className="size-3 rounded-full bg-[#febc2e]" />
          <i className="size-3 rounded-full bg-[#28c840]" />
        </span>
        <span className="truncate pl-1 font-mono text-sm text-zinc-400">claude -p · playground</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {running && (
            <span className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-clay">
              <span className="size-2 animate-pulse rounded-full bg-clay" />
              <span className="hidden min-[1440px]:inline">live</span>
            </span>
          )}
          {config.mock && (
            <span
              className="rounded-md border border-amber-400/30 px-1.5 py-0.5 font-mono text-xs uppercase tracking-wider text-amber-300"
              title="KAGAZ_MOCK=1: rehearsal mode with a fake Claude"
            >
              mock
            </span>
          )}
          {(usagePct !== null || usageLimited) && (
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-xs ${
                usageLimited || (usagePct ?? 0) >= 90
                  ? "bg-red-500/15 text-red-300"
                  : (usagePct ?? 0) >= 75
                    ? "bg-amber-400/15 text-amber-300"
                    : "bg-white/[0.04] text-zinc-500"
              }`}
              title={`Claude plan usage, 5-hour window${usage?.resetsAt ? ` (resets ${new Date(usage.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : ""}${usage?.status ? ` · ${usage.status}` : ""}`}
            >
              {usageLimited && usagePct === null ? "limit" : `plan ${usagePct}%`}
            </span>
          )}
          <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[0.8125rem] text-zinc-300" title={config.cliVersion ?? undefined}>
            {model}
          </span>
        </span>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onWheel={markUserScroll}
        onTouchMove={markUserScroll}
        onPointerDown={markUserScroll}
        onKeyDown={markUserScroll}
        tabIndex={0}
        className="scrollbar-thin min-h-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-clay/50 flex-1 overflow-y-auto px-4 py-3 font-mono text-[0.95rem] leading-[1.6rem] min-[1700px]:text-base"
        role="log"
        aria-live="polite"
      >
        {hasItems ? (
          <div ref={contentRef}>
            {feed.map((item, i) => (
              <FeedLine key={item.id} item={item} offset={offsets[i]} separator={i > 0 && item.kind === "user"} />
            ))}
          </div>
        ) : (
          <EmptyFeed />
        )}
      </div>

      {!stuck && hasItems && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="focus-ring absolute bottom-3 right-4 flex h-9 items-center gap-1.5 rounded-full bg-white/[0.12] px-3.5 font-sans text-sm font-medium text-white shadow-lg backdrop-blur hover:bg-white/[0.18]"
        >
          <IconArrowDown className="size-4" />
          Latest
        </button>
      )}
    </section>
  );
}

function EmptyFeed() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-lg text-zinc-300">
        <span className="text-zinc-600">$ </span>
        Waiting for a sketch…
        <Cursor />
      </p>
      <p className="max-w-sm font-sans text-[0.9375rem] leading-relaxed text-zinc-500">
        Drop a photo anywhere, pick a sample, or scan the phone QR code. Claude’s steps stream here live.
      </p>
    </div>
  );
}

function Cursor() {
  return <span className="ml-1 inline-block h-[1.1em] w-[0.55em] animate-blink bg-current align-[-0.2em]" aria-hidden="true" />;
}

function ThinkingDots() {
  return (
    <span aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="animate-dot" style={{ animationDelay: `${i * 0.18}s` }}>
          .
        </span>
      ))}
    </span>
  );
}

interface FeedLineProps {
  item: FeedItem;
  offset: number | null;
  separator: boolean;
}

const FeedLine = memo(
  function FeedLine({ item, offset, separator }: FeedLineProps) {
    const kind = KIND[item.kind] ?? KIND.system;
    const Icon = kind.icon;
    const thinking = item.kind === "thinking";
    // Live "Thinking…" gets animated dots instead of its own trailing dots.
    const text = thinking && item.live ? item.text.replace(/[.…]+$/, "") : item.text;
    return (
      <div className={cx("animate-line-in", separator && "mt-2.5 border-t border-dashed border-white/10 pt-2.5")}>
        <div className="grid grid-cols-[4.5rem_1.25rem_minmax(0,1fr)] items-start gap-x-2.5 py-[3px]">
          <span className="pt-px text-right text-[0.8125rem] text-zinc-500 tabular-nums">
            {offset == null ? "" : formatOffset(offset)}
          </span>
          <span className={cx("flex h-[1.6rem] items-center", kind.iconClass)}>
            <Icon className="size-[1.05rem]" strokeWidth={item.kind === "done" || item.kind === "error" ? 3 : 2} />
          </span>
          <span className={cx("break-words", kind.textClass)}>
            {text}
            {thinking && item.live && <ThinkingDots />}
            {item.detail && <span className="ml-2 whitespace-nowrap font-normal not-italic text-zinc-400">{item.detail}</span>}
            {item.live && !thinking && <Cursor />}
          </span>
        </div>
      </div>
    );
  },
  (a, b) =>
    a.offset === b.offset &&
    a.separator === b.separator &&
    a.item.id === b.item.id &&
    a.item.kind === b.item.kind &&
    a.item.text === b.item.text &&
    a.item.detail === b.item.detail &&
    a.item.live === b.item.live,
);
