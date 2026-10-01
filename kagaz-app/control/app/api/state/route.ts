import { detectFeatures } from "@/lib/claude";
import { guardHost, json } from "@/lib/http";
import { getState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = guardHost(req);
  if (blocked) return blocked;
  void detectFeatures();
  return json(getState());
}
