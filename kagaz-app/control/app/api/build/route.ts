// Start a build: multipart/form-data with a "file" image, or JSON { "sample": "todo" }.
import { errorResponse, guardLocal, json, jsonError, readJson } from "@/lib/http";
import { sniffImage } from "@/lib/playground";
import { startBuild, startBuildFromSample } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;
const HEIC_MESSAGE = "HEIC photos aren't supported — export as JPEG";

export async function POST(req: Request) {
  const blocked = guardLocal(req);
  if (blocked) return blocked;
  try {
    const type = (req.headers.get("content-type") ?? "").toLowerCase();

    if (type.startsWith("multipart/form-data")) {
      if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 1024 * 1024) {
        return jsonError(413, "That photo is too big (max 15 MB)");
      }
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return jsonError(400, "Could not read the upload");
      }
      const file = form.get("file");
      if (!file || typeof file === "string") return jsonError(400, 'Send the photo in a form field called "file"');
      if (file.size > MAX_BYTES) return jsonError(413, "That photo is too big (max 15 MB)");
      if (file.size === 0) return jsonError(400, "That file is empty");
      const mime = (file.type || "").toLowerCase();
      if (/hei[cf]/.test(mime) || /\.hei[cf]$/i.test(file.name)) return jsonError(415, HEIC_MESSAGE);
      if (mime && !mime.startsWith("image/") && mime !== "application/octet-stream") {
        return jsonError(415, "Upload a JPEG, PNG, WebP or GIF image");
      }
      const data = Buffer.from(await file.arrayBuffer());
      const kind = sniffImage(data);
      if (kind === "heic") return jsonError(415, HEIC_MESSAGE);
      if (!kind) return jsonError(415, "Upload a JPEG, PNG, WebP or GIF image");
      const name = (file.name || "").trim().slice(0, 80) || "Uploaded photo";
      const { runId } = await startBuild({ data, ext: kind, name });
      return json({ ok: true, runId }, 202);
    }

    const body = await readJson(req);
    if (typeof body.sample !== "string" || !body.sample) {
      return jsonError(400, 'Send a photo (multipart "file") or JSON { "sample": "todo" }');
    }
    const { runId } = await startBuildFromSample(body.sample);
    return json({ ok: true, runId }, 202);
  } catch (err) {
    return errorResponse(err);
  }
}
