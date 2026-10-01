"use client";

import { useEffect, useState } from "react";
import type { PhoneInfo } from "@/lib/types";
import { IconPhone, IconSpinner, IconWifi, IconX } from "./icons";
import { useToast } from "./Toasts";
import { api, cx, postJson } from "./util";

interface PhoneModalProps {
  open: boolean;
  onClose: () => void;
  phone: PhoneInfo | null;
  onPhoneChange: (info: PhoneInfo) => void;
}

/** QR code for the LAN upload page. Auto-closed by <Stage/> when a run starts. */
export function PhoneModal({ open, onClose, phone, onPhoneChange }: PhoneModalProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void api<PhoneInfo>("/api/phone").then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (r.ok && r.data) onPhoneChange(r.data);
      else if (!r.ok) toast(r.error, "error");
    });
    return () => {
      cancelled = true;
    };
  }, [open, onPhoneChange, toast]);

  if (!open) return null;

  const enabled = !!phone?.enabled;

  const toggle = async () => {
    setToggling(true);
    const r = await postJson<PhoneInfo>("/api/phone", { enable: !enabled });
    setToggling(false);
    if (r.ok && r.data) onPhoneChange(r.data);
    else if (!r.ok) toast(r.error, "error");
  };

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade-in place-items-center overflow-y-auto bg-black/65 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-title"
        className="w-full max-w-[46rem] animate-pop rounded-3xl border border-white/10 bg-[#10131a] p-7 shadow-2xl shadow-black"
      >
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-clay/15 text-clay">
            <IconPhone className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="phone-title" className="text-2xl font-semibold text-white">
              Upload from your phone
            </h2>
            <p className="mt-1 text-base text-zinc-400">Photograph the judge’s sketch — it lands here and the build starts.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring -mr-2 -mt-1 rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <IconX className="size-5" />
          </button>
        </div>

        <div className="mt-6 flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-medium text-white">Enable phone upload</p>
            <p className="text-sm text-zinc-400">
              Opens a small upload page{phone?.port ? ` on port ${phone.port}` : ""}, protected by a secret token in the QR code.
            </p>
          </div>
          {(loading || toggling) && <IconSpinner className="size-5 animate-spin text-zinc-400" />}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Enable phone upload"
            onClick={() => void toggle()}
            disabled={toggling || (loading && !phone)}
            className={cx(
              "focus-ring relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50",
              enabled ? "bg-emerald-500" : "bg-white/15",
            )}
          >
            <span
              className={cx(
                "absolute left-1 top-1 size-6 rounded-full bg-white shadow transition-transform",
                enabled && "translate-x-6",
              )}
            />
          </button>
        </div>

        {phone?.error && (
          <p role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-[0.9375rem] text-red-200">
            {phone.error}
          </p>
        )}

        {enabled && phone?.qrSvg ? (
          <div className="mt-6 flex items-center gap-7">
            <div
              className="size-[min(320px,42vh)] shrink-0 rounded-2xl bg-white p-4 shadow-xl [&>svg]:block [&>svg]:size-full"
              aria-label="QR code for the phone upload page"
              role="img"
              dangerouslySetInnerHTML={{ __html: phone.qrSvg }}
            />
            <div className="min-w-0 flex-1">
              <ol className="space-y-3 text-lg text-zinc-200">
                <li><span className="mr-2 font-mono text-clay">1</span>Join the same Wi‑Fi</li>
                <li><span className="mr-2 font-mono text-clay">2</span>Scan with the camera</li>
                <li><span className="mr-2 font-mono text-clay">3</span>Snap the sketch</li>
              </ol>
              {phone.url && (
                <p className="mt-5 break-all rounded-lg bg-black/40 px-3 py-2 font-mono text-sm text-zinc-300 select-all">
                  {phone.url}
                </p>
              )}
              <p className="mt-3 flex items-center gap-2 text-sm text-amber-200/80">
                <IconWifi className="size-4 shrink-0" />
                Same Wi‑Fi only — guest networks often block this.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6 grid h-40 place-items-center rounded-2xl border border-dashed border-white/10 text-center text-base text-zinc-500">
            {enabled ? "Waiting for the QR code…" : "Turn on phone upload to show the QR code."}
          </div>
        )}
      </div>
    </div>
  );
}
