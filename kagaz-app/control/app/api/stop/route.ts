import { errorResponse, guardLocal, json } from "@/lib/http";
import { stopRun } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const blocked = guardLocal(req);
  if (blocked) return blocked;
  try {
    const { stopped } = await stopRun();
    return json({ ok: true, stopped });
  } catch (err) {
    return errorResponse(err);
  }
}
