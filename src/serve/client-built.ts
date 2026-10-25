/** Serves the built client from its output folder (#werk-stack-layout). */
import { join } from "node:path";
import type { ClientServer } from "./client-server.ts";
import { injectToken } from "./page-html.ts";
import { staticPath } from "./static-path.ts";

const NOT_BUILT =
  "<!doctype html><title>werk</title><p>The client is not built. Run make build, or start the server with WERK_DEV=1.</p>";

const HTML = { "content-type": "text/html; charset=utf-8" };

export function builtClient(outDir: string): ClientServer {
  const index = Bun.file(join(outDir, "index.html"));
  return {
    async page(token) {
      if (!(await index.exists())) {
        return new Response(injectToken(NOT_BUILT, token), {
          status: 503,
          headers: HTML,
        });
      }
      return new Response(injectToken(await index.text(), token), {
        headers: HTML,
      });
    },
    async asset(req) {
      const path = staticPath(new URL(req.url).pathname);
      if (path === null) return null;
      const file = Bun.file(join(outDir, path));
      return (await file.exists()) ? new Response(file) : null;
    },
  };
}
