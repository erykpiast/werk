/** The client that a release executable carries: its page and files come from the registered list (#werk-dist). */
import type { ClientServer } from "../serve/client-server.ts";
import { injectToken } from "../serve/page-html.ts";

const HTML = { "content-type": "text/html; charset=utf-8" };

/** A client server over embedded files, or null when the list has no page. */
export function embeddedClient(
  files: Readonly<Record<string, string>>,
): ClientServer | null {
  const index = files["/index.html"];
  if (index === undefined) return null;
  return {
    async page(token) {
      const html = await Bun.file(index).text();
      return new Response(injectToken(html, token), { headers: HTML });
    },
    async asset(req) {
      const path = files[new URL(req.url).pathname];
      return path === undefined ? null : new Response(Bun.file(path));
    },
  };
}
