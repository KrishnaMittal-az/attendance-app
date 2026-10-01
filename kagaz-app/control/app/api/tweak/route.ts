// Follow-up change to the current app: JSON { "text": "make it dark mode" }.
import { errorResponse, guardLocal, json, jsonError, readJson } from "@/lib/http";
import { startTweak } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const blocked = guardLocal(req);
  if (blocked) return blocked;
  try {
    const body = await readJson(req);
    if (typeof body.text !== "string") return jsonError(400, 'Send JSON { "text": "…" }');
    const { runId } = await startTweak(body.text);
    return json({ ok: true, runId }, 202);
  } catch (err) {
    return errorResponse(err);
  }
}
