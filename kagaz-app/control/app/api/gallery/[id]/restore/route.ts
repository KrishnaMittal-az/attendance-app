// Put a gallery snapshot back into playground/ (stage shows it as the current app; tweaks work again).
import { errorResponse, guardLocal, json, jsonError, SAFE_ID } from "@/lib/http";
import { restoreSnapshot } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = guardLocal(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  if (!SAFE_ID.test(id)) return jsonError(400, "Invalid id");
  try {
    await restoreSnapshot(id);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
