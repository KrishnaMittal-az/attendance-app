"use client";

import type { KagazState, SampleInfo } from "@/lib/types";
import { IconCamera, IconSpinner, IconUpload } from "./icons";

interface SketchPanelProps {
  sketch: KagazState["sketch"];
  samples: SampleInfo[];
  /** "upload" while a photo is being sent, a sample id while that sample starts, else null */
  busy: string | null;
  /** Claude is still looking at the sketch (running, nothing written yet) */
  scanning: boolean;
  onPick: () => void;
  onSample: (id: string) => void;
}

// The photo / dropzone is the one flexible box in the left column: it has a
// preferred height but gives way (down to 7.5rem) on short screens so the
// activity feed keeps its minimum height.
const MEDIA_BOX = "relative min-h-30 shrink basis-[clamp(160px,30vh,360px)] overflow-hidden rounded-xl";

export function SketchPanel({ sketch, samples, busy, scanning, onPick, onSample }: SketchPanelProps) {
  return (
    <section className="flex min-h-0 shrink flex-col rounded-2xl border border-white/[0.07] bg-panel p-3.5" aria-label="Sketch">
      {sketch ? (
        <SketchPhoto sketch={sketch} scanning={scanning} uploading={busy === "upload"} onPick={onPick} />
      ) : (
        <Dropzone uploading={busy === "upload"} onPick={onPick} />
      )}

      {samples.length > 0 &&
        (sketch ? (
          <SampleChips samples={samples} busy={busy} onSample={onSample} />
        ) : (
          <SampleCards samples={samples} busy={busy} onSample={onSample} />
        ))}
    </section>
  );
}

function Dropzone({ uploading, onPick }: { uploading: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={uploading}
      className={`${MEDIA_BOX} focus-ring paper-ruled group flex flex-col items-center justify-center gap-2 border-2 border-dashed border-ink/25 px-6 text-center text-ink shadow-[inset_0_0_40px_rgba(120,90,40,0.12)] transition hover:border-ink/50`}
    >
      <span className="grid size-14 shrink-0 place-items-center rounded-full bg-ink/[0.07] text-ink/70 transition group-hover:scale-105 group-hover:bg-ink/10">
        <IconCamera className="size-7" />
      </span>
      <span className="font-hand text-[1.9rem] leading-tight">Drop a sketch photo here</span>
      <span className="text-[0.9375rem] text-ink/60">or click to choose · drop it anywhere on the screen</span>
      {uploading && <UploadingVeil />}
    </button>
  );
}

function SketchPhoto({
  sketch,
  scanning,
  uploading,
  onPick,
}: {
  sketch: NonNullable<KagazState["sketch"]>;
  scanning: boolean;
  uploading: boolean;
  onPick: () => void;
}) {
  return (
    <div className={`${MEDIA_BOX} bg-paper shadow-[inset_0_0_40px_rgba(120,90,40,0.15)]`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={sketch.url}
        src={sketch.url}
        alt={`Sketch: ${sketch.name}`}
        className="absolute inset-0 size-full animate-fade-in object-contain p-2"
      />
      {scanning && (
        <div className="pointer-events-none absolute inset-x-0 h-[22%] animate-scan bg-linear-to-b from-transparent via-clay/25 to-transparent">
          <div className="absolute inset-x-0 top-1/2 h-px bg-clay/70 shadow-[0_0_12px_2px_rgba(217,119,87,0.5)]" />
        </div>
      )}
      <button
        type="button"
        onClick={onPick}
        className="focus-ring absolute right-2.5 top-2.5 flex h-9 items-center gap-1.5 rounded-lg bg-black/70 px-3 text-sm font-medium text-white shadow-lg backdrop-blur transition hover:bg-black/85"
      >
        <IconUpload className="size-4" />
        New sketch
      </button>
      {uploading && <UploadingVeil />}
    </div>
  );
}

interface SamplesProps {
  samples: SampleInfo[];
  busy: string | null;
  onSample: (id: string) => void;
}

/** No sketch yet: three paper thumbnails under the dropzone. */
function SampleCards({ samples, busy, onSample }: SamplesProps) {
  return (
    <div className="mt-3.5 shrink-0">
      <p className="mb-2 text-sm font-medium text-zinc-400">Try a sample:</p>
      <div className="grid grid-cols-3 gap-2.5">
        {samples.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSample(s.id)}
            disabled={busy !== null}
            className="focus-ring group flex min-w-0 flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1.5 text-left transition hover:border-white/20 hover:bg-white/[0.07] disabled:opacity-50"
          >
            <span className="relative block h-16 overflow-hidden rounded-lg bg-paper ring-1 ring-black/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt="" className="size-full object-cover object-top transition duration-300 group-hover:scale-105" />
              {busy === s.id && (
                <span className="absolute inset-0 grid place-items-center bg-paper/80">
                  <IconSpinner className="size-5 animate-spin text-ink" />
                </span>
              )}
            </span>
            <span className="truncate px-1 pb-0.5 text-sm font-medium text-zinc-200 group-hover:text-white">{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Sketch present: samples collapse into a row of small chips. */
function SampleChips({ samples, busy, onSample }: SamplesProps) {
  return (
    <div className="scrollbar-none -m-1 mt-2 flex shrink-0 items-center gap-2 overflow-x-auto p-1">
      <span className="shrink-0 pr-0.5 text-[0.8125rem] text-zinc-500">Samples</span>
      {samples.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSample(s.id)}
          disabled={busy !== null}
          className="focus-ring flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] pl-1 pr-3 text-[0.8125rem] font-medium text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
        >
          <span className="grid size-6 place-items-center overflow-hidden rounded-full bg-paper">
            {busy === s.id ? (
              <IconSpinner className="size-3.5 animate-spin text-ink" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.url} alt="" className="size-full object-cover" />
            )}
          </span>
          {s.name}
        </button>
      ))}
    </div>
  );
}

function UploadingVeil() {
  return (
    <span className="absolute inset-0 flex items-center justify-center gap-3 bg-paper/85 font-hand text-2xl text-ink backdrop-blur-[1px]">
      <IconSpinner className="size-6 animate-spin" />
      Uploading…
    </span>
  );
}
