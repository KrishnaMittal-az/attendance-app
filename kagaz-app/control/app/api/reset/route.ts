// Stop any run and restore playground/ to the committed template (git checkout + git clean).
import { errorResponse, guardLocal, json } from "@/lib/http";
import { resetAll } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const blocked = guardLocal(req);
  if (blocked) return blocked;
  try {
    await resetAll();
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
