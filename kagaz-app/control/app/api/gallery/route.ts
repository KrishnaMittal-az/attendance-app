import { listGallery } from "@/lib/gallery";
import { guardHost, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = guardHost(req);
  if (blocked) return blocked;
  return json(await listGallery());
}
