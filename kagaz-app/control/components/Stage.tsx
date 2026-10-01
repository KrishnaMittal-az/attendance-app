"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhoneInfo, SampleInfo } from "@/lib/types";
import { ActivityFeed } from "./ActivityFeed";
import { ErrorBanner } from "./ErrorBanner";
import { GalleryDrawer } from "./GalleryDrawer";
import { IconAlert, IconSpinner } from "./icons";
import { PhoneModal } from "./PhoneModal";
import { PreviewPanel } from "./PreviewPanel";
import { SketchPanel } from "./SketchPanel";
import { ToastProvider, useToast } from "./Toasts";
import { TopBar } from "./TopBar";
import { TweakBox } from "./TweakBox";
import { useKagazState } from "./useKagazState";
import {
  api,
  asArray,
  BUSY_MESSAGE,
  failureText,
  firstImage,
  isImageFile,
  postJson,
  prepareImage,
  type ApiResult,
} from "./util";

export default function Stage() {
  return (
    <ToastProvider>
      <StageScreen />
    </ToastProvider>
  );
}

function StageScreen() {
  const { state, reconnecting } = useKagazState();
  const toast = useToast();
  const running = state.status === "running";

  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // "upload" | sample id
  const [dragging, setDragging] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phone, setPhone] = useState<PhoneInfo | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Read inside window listeners / async handlers without re-binding them.
  const statusRef = useRef(state.status);
  const busyRef = useRef(false);
  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  // Samples (retry a few times in case the API is still compiling) + phone status for the badge.
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const loadSamples = (attempt: number) => {
      void api<unknown>("/api/samples").then((r) => {
        if (cancelled) return;
        if (r.ok) setSamples(asArray<SampleInfo>(r.data, "samples"));
        else if (attempt < 5) retry = setTimeout(() => loadSamples(attempt + 1), 2000);
      });
    };
    loadSamples(0);
    void api<PhoneInfo>("/api/phone").then((r) => {
      if (!cancelled && r.ok && r.data) setPhone(r.data);
    });
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, []);

  // A run starting (e.g. from the phone) takes over the screen: close modal + drawer.
  const prevStatus = useRef(state.status);
  useEffect(() => {
    if (state.status === "running" && prevStatus.current !== "running") {
      setPhoneOpen(false);
      setGalleryOpen(false);
    }
    prevStatus.current = state.status;
  }, [state.status]);

  /* ------------------------------------------------------------ actions */

  const startBuild = useCallback(
    async (key: string, send: () => Promise<ApiResult<unknown>>) => {
      if (statusRef.current === "running") {
        toast(BUSY_MESSAGE, "error");
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(key);
      try {
        const r = await send();
        if (!r.ok) toast(failureText(r), "error");
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [toast],
  );

  const uploadFile = useCallback(
    (file: File) => {
      if (!isImageFile(file)) {
        toast("That isn’t an image — use a JPG or PNG photo", "error");
        return;
      }
      void startBuild("upload", async () => {
        const { blob, name } = await prepareImage(file);
        const form = new FormData();
        form.append("file", blob, name);
        return api("/api/build", { method: "POST", body: form });
      });
    },
    [startBuild, toast],
  );

  const buildSample = useCallback(
    (id: string) => void startBuild(id, () => postJson("/api/build", { sample: id })),
    [startBuild],
  );

  const sendTweak = useCallback(
    async (text: string) => {
      const r = await postJson("/api/tweak", { text });
      if (!r.ok) toast(failureText(r), "error");
      return r.ok;
    },
    [toast],
  );

  const stop = useCallback(async () => {
    const r = await postJson("/api/stop");
    if (!r.ok) toast(r.error, "error");
  }, [toast]);

  const reset = useCallback(async () => {
    const r = await postJson("/api/reset");
    if (r.ok) toast("Playground restored to the clean template", "success");
    else toast(r.error, "error");
  }, [toast]);

  const openPicker = useCallback(() => {
    if (statusRef.current === "running") toast(BUSY_MESSAGE, "error");
    else fileInput.current?.click();
  }, [toast]);

  /* ---------------------------------------------- window-level listeners */

  // Drag & drop anywhere on the window; paste an image from the clipboard.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = firstImage(e.dataTransfer?.files);
      if (file) uploadFile(file);
      else toast("Drop an image file (JPG or PNG)", "error");
    };
    const onPaste = (e: ClipboardEvent) => {
      const file = firstImage(e.clipboardData?.files);
      if (!file) return;
      e.preventDefault();
      uploadFile(file);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [uploadFile, toast]);

  // Esc closes the modal / drawer (the Reset popover handles its own Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPhoneOpen(false);
      setGalleryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ------------------------------------------------------------- render */

  const runStart = state.startedAt ?? 0;
  const scanning =
    running &&
    state.mode === "build" &&
    !state.feed.some((item) => item.at >= runStart && (item.kind === "write" || item.kind === "edit"));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-stage text-zinc-100">
      <TopBar
        state={state}
        phoneEnabled={!!phone?.enabled}
        onStop={() => void stop()}
        onReset={() => void reset()}
        onOpenGallery={() => setGalleryOpen(true)}
        onOpenPhone={() => setPhoneOpen(true)}
      />

      <main className="flex min-h-0 flex-1 gap-5 p-5">
        <div className="flex min-h-0 w-[36%] min-w-[480px] shrink-0 flex-col gap-4">
          <SketchPanel
            sketch={state.sketch}
            samples={samples}
            busy={busy}
            scanning={scanning}
            onPick={openPicker}
            onSample={buildSample}
          />
          {state.error && state.status !== "running" && <ErrorBanner message={state.error} />}
          {!state.error && state.config.cliOk === false && !state.config.mock && (
            <ErrorBanner
              message="Claude Code CLI not found: `claude --help` failed."
              hint="Install Claude Code and run `claude` once to log in, or rehearse with npm run dev:mock."
            />
          )}
          <ActivityFeed state={state} />
          <TweakBox canTweak={state.canTweak} running={running} onSend={sendTweak} />
        </div>
        <PreviewPanel state={state} />
      </main>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow picking the same file again
          if (file) uploadFile(file);
        }}
      />

      {dragging && <DropOverlay running={running} />}

      <GalleryDrawer
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        refreshKey={`${state.runId}:${state.status}`}
        running={running}
      />
      <PhoneModal open={phoneOpen} onClose={() => setPhoneOpen(false)} phone={phone} onPhoneChange={setPhone} />

      {reconnecting && (
        <div className="fixed bottom-5 left-1/2 z-[90] flex -translate-x-1/2 animate-fade-in items-center gap-2.5 rounded-full bg-raised px-4 py-2 text-[0.9375rem] font-medium text-amber-200 shadow-2xl shadow-black/60 ring-1 ring-amber-400/40">
          <IconSpinner className="size-4 animate-spin" />
          Reconnecting to the control server…
        </div>
      )}
    </div>
  );
}

function DropOverlay({ running }: { running: boolean }) {
  return (
    <div className="fixed inset-0 z-[70] grid animate-fade-in place-items-center bg-stage/80 p-10 backdrop-blur-sm">
      <div className="paper-ruled flex w-full max-w-3xl flex-col items-center gap-3 rounded-3xl border-4 border-dashed border-ink/30 px-10 py-16 text-center text-ink shadow-2xl">
        <p className="text-balance font-hand text-5xl leading-tight">Drop the sketch to build it</p>
        {running ? (
          <p className="flex items-center gap-2 text-lg font-medium text-red-700">
            <IconAlert className="size-5" />
            {BUSY_MESSAGE}
          </p>
        ) : (
          <p className="text-lg text-ink/60">Claude starts building the moment you let go</p>
        )}
      </div>
    </div>
  );
}
