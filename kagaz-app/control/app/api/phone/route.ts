// Phone upload page on the LAN: GET -> PhoneInfo, POST { "enable": boolean } -> start/stop -> PhoneInfo.
import { errorResponse, guardHost, guardLocal, json, jsonError, readJson } from "@/lib/http";
import { getPhoneInfo, setPhoneEnabled } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = guardHost(req);
  if (blocked) return blocked;
  return json(getPhoneInfo());
}

export async function POST(req: Request) {
  const blocked = guardLocal(req);
  if (blocked) return blocked;
  try {
    const body = await readJson(req);
    if (typeof body.enable !== "boolean") return jsonError(400, 'Send JSON { "enable": true | false }');
    return json(await setPhoneEnabled(body.enable));
  } catch (err) {
    return errorResponse(err);
  }
}
