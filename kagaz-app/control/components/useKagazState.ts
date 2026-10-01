"use client";

import { useEffect, useState } from "react";
import type { KagazState } from "@/lib/types";
import { api, initialState, normalizeState } from "./util";

const RECONNECT_NOTICE_MS = 3000;
const RETRY_MS = 2000;

/**
 * Live server state: GET /api/state once, then SSE `state` events from /api/events.
 * `reconnecting` turns true when the stream has been down for more than 3 s.
 */
export function useKagazState(): { state: KagazState; reconnecting: boolean } {
  const [state, setState] = useState<KagazState>(initialState);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    let disposed = false;
    let gotEvent = false;
    let source: EventSource | null = null;
    let noticeTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const markHealthy = () => {
      if (noticeTimer) clearTimeout(noticeTimer);
      noticeTimer = null;
      setReconnecting(false);
    };
    const markLost = () => {
      if (!noticeTimer) noticeTimer = setTimeout(() => !disposed && setReconnecting(true), RECONNECT_NOTICE_MS);
    };

    const connect = () => {
      source = new EventSource("/api/events");
      source.onopen = markHealthy;
      source.addEventListener("state", (event) => {
        let next: KagazState | null = null;
        try {
          next = normalizeState(JSON.parse((event as MessageEvent<string>).data));
        } catch {
          return;
        }
        if (!next || disposed) return;
        gotEvent = true;
        markHealthy();
        setState(next);
      });
      source.onerror = () => {
        markLost();
        // CONNECTING = the browser retries by itself; CLOSED (e.g. a 500 while the
        // dev server restarts) = it gave up, so open a fresh stream ourselves.
        if (source && source.readyState === EventSource.CLOSED) {
          source.close();
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => !disposed && connect(), RETRY_MS);
        }
      };
    };

    connect();
    void api<unknown>("/api/state").then((r) => {
      if (disposed || gotEvent || !r.ok) return; // SSE already delivered something newer
      const next = normalizeState(r.data);
      if (next) setState(next);
    });

    return () => {
      disposed = true;
      source?.close();
      if (noticeTimer) clearTimeout(noticeTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  return { state, reconnecting };
}
