/**
 * Vite in middleware mode inside the werk server (#werk-stack-framework, #werk-client-reload).
 * Vite's middleware needs a Node request, so it answers on a loopback socket inside this process,
 * and the werk server hands each client request over to it. The browser talks to one port only.
 * A change that Vite cannot apply in place becomes a reload signal on the live channel.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer as createVite, type ViteDevServer } from "vite";
import type { ClientServer } from "./client-server.ts";
import { injectToken } from "./page-html.ts";

export type DevClient = ClientServer & {
  /** The loopback port that Vite answers on. */
  port: number;
  vite: ViteDevServer;
  close(): Promise<void>;
};

type Hot = { send: (...args: unknown[]) => void };

export type DevClientOptions = {
  configFile: string;
  /** Called once for each change that Vite cannot apply in place. */
  onReload: () => void;
};

const SKIPPED_HEADERS = new Set(["host", "connection", "content-length"]);

export async function startDevClient(
  options: DevClientOptions,
): Promise<DevClient> {
  const http = createServer();
  const vite = await createVite({
    configFile: options.configFile,
    appType: "spa",
    clearScreen: false,
    server: { middlewareMode: true, hmr: { server: http } },
  });
  http.on("request", vite.middlewares);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as AddressInfo).port;

  // Vite answers a change it cannot apply in place with a full reload payload. The page reloads
  // by the live channel instead, so the composer draft is stashed first, and Vite's own copy is dropped.
  const hot = vite.environments.client.hot as unknown as Hot;
  const send = hot.send.bind(hot);
  hot.send = (...args) => {
    const payload = args[0] as { type?: string } | undefined;
    if (payload?.type === "full-reload") options.onReload();
    else send(...args);
  };

  const ask = (req: Request) => {
    const url = new URL(req.url);
    const headers = new Headers();
    for (const [name, value] of req.headers) {
      if (!SKIPPED_HEADERS.has(name)) headers.set(name, value);
    }
    return fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      redirect: "manual",
    });
  };

  return {
    port,
    vite,
    async page(token) {
      const res = await ask(new Request("http://werk.invalid/"));
      return new Response(injectToken(await res.text(), token), {
        status: res.status,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
    async asset(req) {
      const res = await ask(req);
      return res.status === 404 ? null : res;
    },
    async close() {
      await vite.close();
      http.close();
    },
  };
}
