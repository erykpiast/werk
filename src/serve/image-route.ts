/**
 * The image routes of one project: an upload that stores a pasted image, and the read that serves a
 * stored image as the chip's thumbnail. Only a file inside the attachments folder is served, and any
 * other name answers 404 (#werk-shots, #werk-chat-image-inline, #werk-crash).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { findImage, storeImage } from "../chat/attachments.ts";
import { MAX_IMAGE_BYTES, mimeOfName } from "../chat/image-rules.ts";
import type { Context } from "../projects/context.ts";

export async function imageRoute(
  context: Context,
  req: Request,
  url: URL,
): Promise<Response> {
  if (req.method === "POST") {
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_IMAGE_BYTES) {
      return Response.json(
        {
          error: "too-large",
          message: `the image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
        },
        { status: 413 },
      );
    }
    const stored = storeImage(
      context.logPath,
      new Uint8Array(await req.arrayBuffer()),
    );
    if (stored.ok) return Response.json({ name: stored.name });
    return Response.json(
      { error: "refused", message: stored.message },
      { status: stored.status },
    );
  }
  const name = basename(url.searchParams.get("name") ?? "");
  const path = findImage(context.logPath, name);
  const type = mimeOfName(name);
  if (path === null || type === null)
    return new Response("not found", { status: 404 });
  return new Response(readFileSync(path), {
    headers: { "content-type": type, "x-content-type-options": "nosniff" },
  });
}
