import fs from "node:fs/promises";
import { snapshotSketch } from "@/lib/gallery";
import { guardHost, jsonError, SAFE_ID } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = guardHost(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  if (!SAFE_ID.test(id)) return jsonError(400, "Invalid id");
  const sketch = await snapshotSketch(id);
  if (!sketch) return jsonError(404, "No sketch for this build");
  try {
    const data = await fs.readFile(sketch.file);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": sketch.contentType, "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return jsonError(404, "No sketch for this build");
  }
}
