// JSON helpers, error mapping and the local-only guard for the control API.

/** Thrown when a run is active; routes answer 409. */
export class BusyError extends Error {
  readonly status = 409;
  constructor(message = "Claude is still working — press Stop first") {
    super(message);
    this.name = "BusyError";
  }
}

/** An error with an HTTP status and a message that is safe to show on stage. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

export function jsonError(status: number, error: string): Response {
  return json({ error }, status);
}

/** Maps thrown errors to { error } responses. */
export function errorResponse(err: unknown): Response {
  if (err instanceof BusyError || err instanceof HttpError) return jsonError(err.status, err.message);
  const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500;
  const message = err instanceof Error && err.message ? err.message : "Something went wrong";
  if (status >= 500) console.error("[kagaz] request failed:", err);
  return jsonError(status >= 400 && status < 600 ? status : 500, message);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Hostname from a Host header value ("localhost:3000", "[::1]:3000", "127.0.0.1"). */
function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.indexOf(":");
  return colon === -1 ? h : h.slice(0, colon);
}

function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

/** 403 unless the Host header names this machine (DNS-rebinding protection). For read-only routes. */
export function guardHost(req: Request): Response | null {
  const host = req.headers.get("host");
  if (!host || !isLocalHostname(hostnameOf(host))) {
    return jsonError(403, "The stage screen only works on http://localhost:3000");
  }
  return null;
}

/** 403 unless Host is local and any Origin header is local too (CSRF protection). For mutating routes. */
export function guardLocal(req: Request): Response | null {
  const hostProblem = guardHost(req);
  if (hostProblem) return hostProblem;
  const origin = req.headers.get("origin");
  if (origin !== null) {
    let hostname = "";
    try {
      hostname = new URL(origin).hostname;
    } catch {
      hostname = "";
    }
    if (!isLocalHostname(hostname)) return jsonError(403, "Requests from other sites are not allowed");
  }
  return null;
}

/** Parses a JSON body; returns {} for an empty or invalid body. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (!text.trim()) return {};
    const data: unknown = JSON.parse(text);
    return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const SAFE_ID = /^[A-Za-z0-9_-]+$/;
