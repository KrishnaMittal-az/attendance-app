// The current sketch photo (playground/sketch.<ext>).
import fs from "node:fs/promises";
import { guardHost, jsonError } from "@/lib/http";
import { findSketch } from "@/lib/playground";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = guardHost(req);
  if (blocked) return blocked;
  const sketch = await findSketch();
  if (!sketch) return jsonError(404, "No sketch yet");
  try {
    const data = await fs.readFile(sketch.file);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": sketch.contentType, "Cache-Control": "no-store" },
    });
  } catch {
    return jsonError(404, "No sketch yet");
  }
}
