// Optional phone upload page: a tiny node:http server on the LAN (0.0.0.0:3001), started only when the
// presenter enables it. Every request needs the random token that is only in the on-screen QR code.
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import QRCode from "qrcode";
import { BusyError, HttpError } from "./http";
import { sniffImage } from "./playground";
import { startBuild } from "./runner";
import { getState } from "./store";
import type { PhoneInfo } from "./types";

const MAX_UPLOAD = 15 * 1024 * 1024;
const UPLOAD_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

interface PhoneGlobal {
  server: http.Server | null;
  url: string | null;
  qrSvg: string | null;
  error: string | null;
  pending: Promise<PhoneInfo> | null;
}

const g = globalThis as typeof globalThis & { __kagazPhone?: PhoneGlobal };

function phone(): PhoneGlobal {
  if (!g.__kagazPhone) g.__kagazPhone = { server: null, url: null, qrSvg: null, error: null, pending: null };
  return g.__kagazPhone;
}

function phonePort(): number {
  const n = Number.parseInt(process.env.KAGAZ_PHONE_PORT ?? "", 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 3001;
}

// --- LAN address -------------------------------------------------------------------------------------

const PREFERRED_IFACE = /^(en0|en1|wlan\d*|wl\w*|eth\d*|wi-?fi|ethernet)/i;
const VIRTUAL_IFACE = /^(docker|br-|veth|vmnet|vboxnet|utun|awdl|llw|bridge|tailscale)/i;

function isPrivate(ip: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

/** Non-internal IPv4 addresses, best first (Wi-Fi/Ethernet, then others, virtual adapters last). */
export function lanAddresses(): string[] {
  const found: { address: string; score: number }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      const family = a.family as string | number;
      if (a.internal || (family !== "IPv4" && family !== 4)) continue;
      if (a.address.startsWith("169.254.")) continue; // link-local: no DHCP
      let score = PREFERRED_IFACE.test(name) ? 0 : VIRTUAL_IFACE.test(name) ? 20 : 10;
      if (!isPrivate(a.address)) score += 5;
      found.push({ address: a.address, score });
    }
  }
  found.sort((x, y) => x.score - y.score);
  return [...new Set(found.map((f) => f.address))];
}

export function getPhoneInfo(): PhoneInfo {
  const p = phone();
  return {
    enabled: p.server !== null,
    url: p.url,
    qrSvg: p.qrSvg,
    addresses: lanAddresses(),
    port: phonePort(),
    error: p.error,
  };
}

// --- start / stop ------------------------------------------------------------------------------------

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "0.0.0.0");
  });
}

async function start(): Promise<PhoneInfo> {
  const p = phone();
  if (p.server) return getPhoneInfo();
  p.error = null;
  const port = phonePort();
  const ip = process.env.KAGAZ_LAN_IP?.trim() || lanAddresses()[0];
  if (!ip) {
    p.error = "No Wi-Fi or LAN address found. Join a Wi-Fi network (or your phone's hotspot) and try again.";
    return getPhoneInfo();
  }
  const token = crypto.randomBytes(12).toString("base64url");
  const server = http.createServer((req, res) => handle(req, res, token));
  server.requestTimeout = 120_000;
  server.on("clientError", (_err, socket) => socket.destroy());
  try {
    await listen(server, port);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    p.error =
      e.code === "EADDRINUSE"
        ? `Port ${port} is already in use. Close the other app or set KAGAZ_PHONE_PORT.`
        : `Could not start the phone page: ${e.message}`;
    return getPhoneInfo();
  }
  const url = `http://${ip}:${port}/?t=${token}`;
  try {
    p.qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  } catch (err) {
    p.qrSvg = null;
    p.error = `Could not draw the QR code: ${(err as Error).message}`;
  }
  p.server = server;
  p.url = url;
  console.log(`\n[kagaz] Phone upload page (same Wi-Fi): ${url}`);
  QRCode.toString(url, { type: "terminal", small: true })
    .then((qr) => console.log(qr))
    .catch(() => {});
  return getPhoneInfo();
}

async function stop(): Promise<PhoneInfo> {
  const p = phone();
  const server = p.server;
  p.server = null;
  p.url = null;
  p.qrSvg = null;
  p.error = null;
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    console.log("[kagaz] Phone upload page stopped");
  }
  return getPhoneInfo();
}

/** Turns the LAN page on or off (calls are serialized). */
export function setPhoneEnabled(enable: boolean): Promise<PhoneInfo> {
  const p = phone();
  const previous = p.pending ?? Promise.resolve(getPhoneInfo());
  const next = previous.catch(() => getPhoneInfo()).then(() => (enable ? start() : stop()));
  p.pending = next.finally(() => {
    if (p.pending === next) p.pending = null;
  });
  return next;
}

// --- request handling --------------------------------------------------------------------------------

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function tokenOk(given: string, token: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sendJson(res: http.ServerResponse, status: number, data: unknown, extra: Record<string, string> = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...BASE_HEADERS, ...extra, "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, status: number, html: string) {
  res.writeHead(status, {
    ...BASE_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy":
      "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(html);
}

function handle(req: http.IncomingMessage, res: http.ServerResponse, token: string): void {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://phone.invalid");
  } catch {
    sendHtml(res, 400, FORBIDDEN_PAGE);
    return;
  }
  if (!tokenOk(url.searchParams.get("t") ?? "", token)) {
    req.resume();
    sendHtml(res, 403, FORBIDDEN_PAGE);
    return;
  }
  if (req.method === "GET" && url.pathname === "/") {
    sendHtml(res, 200, UPLOAD_PAGE);
  } else if (req.method === "POST" && url.pathname === "/upload") {
    handleUpload(req, res);
  } else if (req.method === "GET" && url.pathname === "/status") {
    sendJson(res, 200, phoneStatus());
  } else {
    req.resume();
    sendJson(res, 404, { error: "Not found" });
  }
}

function phoneStatus() {
  const s = getState();
  const end = s.status === "running" ? Date.now() : (s.finishedAt ?? Date.now());
  const seconds = s.startedAt ? Math.max(0, Math.round((end - s.startedAt) / 1000)) : 0;
  return { status: s.status, seconds, summary: s.summary, error: s.error, runId: s.runId };
}

function handleUpload(req: http.IncomingMessage, res: http.ServerResponse): void {
  const type = String(req.headers["content-type"] ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!UPLOAD_TYPES.has(type)) {
    req.resume();
    sendJson(res, 415, { error: "Send a JPEG, PNG or WebP photo" });
    return;
  }
  const tooBig = () => {
    sendJson(res, 413, { error: "That photo is too big (max 15 MB)" }, { Connection: "close" });
    req.destroy();
  };
  if (Number(req.headers["content-length"] ?? 0) > MAX_UPLOAD) {
    tooBig();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;
  req.on("data", (chunk: Buffer) => {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_UPLOAD) {
      aborted = true;
      tooBig();
      return;
    }
    chunks.push(chunk);
  });
  req.on("error", () => {
    aborted = true;
  });
  req.on("end", () => {
    if (aborted) return;
    const data = Buffer.concat(chunks);
    const kind = sniffImage(data);
    if (kind === "heic") {
      sendJson(res, 415, { error: "HEIC photos aren't supported — export as JPEG" });
      return;
    }
    if (kind !== "jpg" && kind !== "png" && kind !== "webp") {
      sendJson(res, 415, { error: "That file is not a JPEG, PNG or WebP photo" });
      return;
    }
    startBuild({ data, ext: kind, name: "Phone photo" }).then(
      ({ runId }) => sendJson(res, 202, { ok: true, runId }),
      (err: unknown) => {
        if (err instanceof BusyError || err instanceof HttpError) sendJson(res, err.status, { error: err.message });
        else sendJson(res, 500, { error: (err as Error)?.message || "Could not start the build" });
      },
    );
  });
}

// --- pages -------------------------------------------------------------------------------------------

const FORBIDDEN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kagaz → App</title>
<style>html,body{margin:0;height:100%;background:#0c0a09;color:#fafaf9;font:18px/1.5 system-ui,-apple-system,sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}
h1{font-size:26px;margin:0 0 8px}p{color:#a8a29e;margin:0}b{color:#f59e0b}</style></head>
<body><main><h1>Kagaz <b>→</b> App</h1><p>Scan the QR code on the stage screen.</p></main></body></html>`;

const UPLOAD_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0c0a09">
<meta name="color-scheme" content="dark">
<title>Kagaz → App · Phone</title>
<style>
  :root { --bg:#0c0a09; --card:#1c1917; --line:#2e2a27; --text:#fafaf9; --dim:#a8a29e; --accent:#f59e0b; --ok:#34d399; --err:#f87171; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; background: var(--bg); color: var(--text); }
  body { font: 17px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-text-size-adjust: 100%; }
  main { min-height: 100vh; min-height: 100svh; display: flex; flex-direction: column; gap: 22px; max-width: 520px; margin: 0 auto;
         padding: max(28px, env(safe-area-inset-top)) 20px max(28px, env(safe-area-inset-bottom)); }
  h1 { margin: 0; font-size: 30px; letter-spacing: -0.02em; }
  h1 b { color: var(--accent); }
  .lead { margin: 6px 0 0; color: var(--dim); }
  .btn { position: relative; display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%; min-height: 64px;
         border-radius: 20px; border: 0; font: inherit; font-size: 20px; font-weight: 700; cursor: pointer; user-select: none; -webkit-user-select: none;
         transition: transform .08s ease, filter .15s ease; }
  .btn:active { transform: scale(.98); filter: brightness(.95); }
  .primary { min-height: 132px; font-size: 25px; color: #1c1917; background: linear-gradient(180deg, #fbbf24, #f59e0b);
             box-shadow: 0 18px 40px -18px rgba(245,158,11,.75); }
  .secondary { background: var(--card); color: var(--text); border: 1px solid var(--line); }
  .emoji { font-size: 1.3em; }
  .file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; pointer-events: none; }
  .tip { color: var(--dim); font-size: 15px; margin: 4px 2px 0; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 22px; padding: 14px; }
  .thumb { display: block; width: 100%; max-height: 46vh; max-height: 46svh; object-fit: contain; border-radius: 14px; background: #000; }
  .status { margin: 4px 0 0; text-align: center; font-size: 24px; font-weight: 800; letter-spacing: -0.01em; }
  .status.ok { color: var(--ok); } .status.err { color: var(--err); }
  .sub { margin: 0; text-align: center; color: var(--dim); }
  .dots::after { content: ""; display: inline-block; width: 1.2em; text-align: left; animation: dots 1.2s steps(4) infinite; }
  @keyframes dots { 0% { content: ""; } 25% { content: "."; } 50% { content: ".."; } 75% { content: "..."; } }
  .hidden { display: none !important; }
</style>
</head>
<body>
<main>
  <header>
    <h1>Kagaz <b>→</b> App</h1>
    <p class="lead">Photograph the paper sketch. It appears on the big screen right away.</p>
  </header>

  <section id="pick">
    <label class="btn primary" for="camera"><span class="emoji">📸</span> Snap the sketch</label>
    <input class="file" id="camera" type="file" accept="image/*" capture="environment">
    <div style="height:14px"></div>
    <label class="btn secondary" for="library"><span class="emoji">🖼️</span> Choose a photo</label>
    <input class="file" id="library" type="file" accept="image/*">
    <p class="tip">Tip: fill the frame with the paper, in good light, without shadows.</p>
  </section>

  <section id="progress" class="hidden">
    <div class="card"><img id="thumb" class="thumb" alt="Your sketch"></div>
    <p id="status" class="status">Preparing photo…</p>
    <p id="sub" class="sub">Keep this page open.</p>
    <div style="height:8px"></div>
    <button id="again" class="btn secondary hidden" type="button"><span class="emoji">✏️</span> Send another sketch</button>
  </section>
</main>
<script>
(function () {
  var token = new URLSearchParams(location.search).get("t") || "";
  var q = "?t=" + encodeURIComponent(token);
  function $(id) { return document.getElementById(id); }
  var pollTimer = null, thumbUrl = null, busy = false;

  function setStatus(text, cls, sub, dots) {
    var el = $("status");
    el.textContent = text;
    el.className = "status" + (cls ? " " + cls : "") + (dots ? " dots" : "");
    if (sub !== undefined) $("sub").textContent = sub;
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight, done: function () { URL.revokeObjectURL(url); } }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not read that photo")); };
      img.src = url;
    });
  }

  async function decode(file) {
    if (window.createImageBitmap) {
      try {
        var bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
        return { src: bmp, w: bmp.width, h: bmp.height, done: function () { if (bmp.close) bmp.close(); } };
      } catch (e) { /* fall back to <img> */ }
    }
    return loadImage(file);
  }

  async function downscale(file) {
    var MAX = 1600;
    var img = await decode(file);
    var scale = Math.min(1, MAX / Math.max(img.w, img.h));
    var w = Math.max(1, Math.round(img.w * scale)), h = Math.max(1, Math.round(img.h * scale));
    var canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img.src, 0, 0, w, h);
    img.done();
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/jpeg", 0.85); });
    if (!blob) throw new Error("Could not prepare that photo");
    return blob;
  }

  function showPicker() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null; busy = false;
    $("progress").classList.add("hidden");
    $("pick").classList.remove("hidden");
    $("again").classList.add("hidden");
  }

  function finish(text, cls, sub) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null; busy = false;
    setStatus(text, cls, sub, false);
    $("again").classList.remove("hidden");
  }

  async function send(file) {
    if (busy) return;
    busy = true;
    $("pick").classList.add("hidden");
    $("progress").classList.remove("hidden");
    $("again").classList.add("hidden");
    $("thumb").removeAttribute("src");
    setStatus("Preparing photo", "", "Keep this page open.", true);
    try {
      var blob = await downscale(file);
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      thumbUrl = URL.createObjectURL(blob);
      $("thumb").src = thumbUrl;
      setStatus("Sending", "", "Keep this page open.", true);
      var res = await fetch("/upload" + q, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      var data = {};
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) throw new Error(data.error || ("Upload failed (" + res.status + ")"));
      setStatus("Building on the big screen… 0s", "", "Watch the stage screen ✨", false);
      poll(data.runId);
    } catch (err) {
      finish("Didn't work", "err", (err && err.message) || "Upload failed. Check the Wi-Fi and try again.");
    }
  }

  function poll(runId) {
    pollTimer = setTimeout(async function () {
      try {
        var res = await fetch("/status" + q, { cache: "no-store" });
        if (res.status === 403) return finish("Link expired", "err", "Scan the QR code on the stage screen again.");
        var s = await res.json();
        if (s.runId !== runId && s.status !== "running") return finish("Done", "ok", "");
        if (s.status === "running") {
          setStatus("Building on the big screen… " + s.seconds + "s", "", "Watch the stage screen ✨", false);
          return poll(runId);
        }
        if (s.status === "done") return finish("Done in " + s.seconds + "s 🎉", "ok", s.summary || "Your app is live on the big screen.");
        if (s.status === "error") return finish("Something went wrong", "err", s.error || "Check the stage screen.");
        if (s.status === "stopped") return finish("Stopped", "err", "The build was stopped on the stage screen.");
        return finish("Ready", "", "The stage screen was reset.");
      } catch (e) {
        $("sub").textContent = "Reconnecting…";
        poll(runId);
      }
    }, 1500);
  }

  function onPick(e) {
    var input = e.target;
    var file = input.files && input.files[0];
    if (file) send(file);
    input.value = "";
  }
  $("camera").addEventListener("change", onPick);
  $("library").addEventListener("change", onPick);
  $("again").addEventListener("click", showPicker);
})();
</script>
</body>
</html>`;
