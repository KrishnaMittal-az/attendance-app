"use client";

import { useState } from "react";
import { IconArrowUp, IconSpinner } from "./icons";
import { cx } from "./util";

// Short labels keep the chips on one row on a laptop; the full sentence is what gets sent.
const QUICK_TWEAKS = [
  { label: "Dark mode", text: "Make it dark mode" },
  { label: "Delete button", text: "Add a delete button" },
  { label: "Search bar", text: "Add a search bar" },
  { label: "Hindi + English", text: "Make it Hindi + English" },
];

interface TweakBoxProps {
  canTweak: boolean;
  running: boolean;
  /** Resolves true when the server accepted the tweak. */
  onSend: (text: string) => Promise<boolean>;
}

export function TweakBox({ canTweak, running, onSend }: TweakBoxProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const disabled = !canTweak || running || sending;

  const placeholder = running
    ? "Tweaks open when Claude finishes"
    : !canTweak
      ? "Build an app first, then ask for changes"
      : "Ask for a change… e.g. make it dark mode";

  const submit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    setSending(true);
    const accepted = await onSend(trimmed);
    setSending(false);
    if (accepted) setText("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(text);
      }}
      className="shrink-0 rounded-2xl border border-white/[0.07] bg-panel p-3"
      aria-label="Tweak the app"
    >
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Ask Claude for a change"
          enterKeyHint="send"
          autoComplete="off"
          spellCheck={false}
          className="focus-ring h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 text-base text-white placeholder:text-zinc-500 min-[1440px]:text-[1.0625rem] focus:border-clay/60 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          className="focus-ring flex h-12 shrink-0 items-center gap-2 rounded-xl bg-clay px-5 text-base font-semibold text-white shadow-lg shadow-clay/20 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-zinc-500 disabled:shadow-none"
        >
          {sending ? <IconSpinner className="size-5 animate-spin" /> : <IconArrowUp className="size-5" strokeWidth={2.5} />}
          Send
        </button>
      </div>
      {/* p-1/-m-1 leaves room for focus rings inside the scroll box */}
      <div className="scrollbar-none -m-1 mt-1.5 flex gap-1.5 overflow-x-auto p-1 min-[1440px]:gap-2">
        {QUICK_TWEAKS.map((t) => (
          <button
            key={t.text}
            type="button"
            title={`Send: “${t.text}”`}
            disabled={disabled}
            onClick={() => void submit(t.text)}
            className={cx(
              "focus-ring h-8 shrink-0 rounded-full border px-2.5 text-[0.8125rem] font-medium transition min-[1440px]:px-3 min-[1440px]:text-sm",
              "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-clay/50 hover:bg-clay/10 hover:text-white",
              "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-white/[0.04] disabled:hover:text-zinc-300",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </form>
  );
}
