// Server-Sent Events: the stage screen's live view of KagazState.
import { detectFeatures } from "@/lib/claude";
import { guardHost } from "@/lib/http";
import { getState, subscribe } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_MS = 15_000;

export async function GET(req: Request) {
  const blocked = guardHost(req);
  if (blocked) return blocked;
  void detectFeatures(); // warm up (fills config.cliVersion) before the first run

  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: () => void = () => {};
      let ping: ReturnType<typeof setInterval> | null = null;

      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (ping) clearInterval(ping);
        req.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      send(`retry: 2000\nevent: state\ndata: ${JSON.stringify(getState())}\n\n`);
      unsubscribe = subscribe((json) => send(`event: state\ndata: ${json}\n\n`));
      ping = setInterval(() => send(": ping\n\n"), PING_MS);
      if (req.signal.aborted) cleanup();
      else req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
