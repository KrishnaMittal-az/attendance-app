import fs from "node:fs/promises";
import { guardHost, jsonError } from "@/lib/http";
import { getSample } from "@/lib/samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = guardHost(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const sample = await getSample(id);
  if (!sample) return jsonError(404, "No such sample");
  try {
    const data = await fs.readFile(sample.file);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": sample.contentType, "Cache-Control": "no-cache" },
    });
  } catch {
    return jsonError(404, "No such sample");
  }
}
