/** Maps a request path to a file inside the built client, and refuses any path that leaves it. */
import { posix } from "node:path";

/** The path of the file under the output folder, or null when the request path is unsafe. */
export function staticPath(requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const parts = decoded.split("/");
  if (parts.includes("..")) return null;
  const clean = posix.normalize(decoded).replace(/^\/+/, "");
  return clean === "" || clean === "." ? "index.html" : clean;
}
