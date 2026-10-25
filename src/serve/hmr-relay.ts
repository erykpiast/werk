/**
 * Relays Vite's hot-update socket from the werk port to Vite's loopback socket, so the browser
 * opens no second port (#werk-client-reload). Messages go through untouched in both directions.
 */
export type RelayData = {
  vitePort: number;
  search: string;
  upstream?: WebSocket;
  /** Messages that came before the upstream socket opened. */
  queue: (string | Buffer)[];
};

const PROTOCOL = "vite-hmr";

/** True for the socket that Vite's client opens. */
export function wantsHmr(req: Request): boolean {
  return (
    req.headers.get("upgrade")?.toLowerCase() === "websocket" &&
    (req.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .some((p) => p.trim() === PROTOCOL)
  );
}

export function upgradeHmr(
  req: Request,
  server: Bun.Server<RelayData>,
  vitePort: number,
): Response | undefined {
  const ok = server.upgrade(req, {
    headers: { "sec-websocket-protocol": PROTOCOL },
    data: { vitePort, search: new URL(req.url).search, queue: [] },
  });
  return ok ? undefined : new Response("upgrade failed", { status: 400 });
}

export const relayHandlers: Bun.WebSocketHandler<RelayData> = {
  open(ws) {
    const { vitePort, search } = ws.data;
    const upstream = new WebSocket(
      `ws://127.0.0.1:${vitePort}/${search}`,
      PROTOCOL,
    );
    ws.data.upstream = upstream;
    upstream.addEventListener("open", () => {
      for (const message of ws.data.queue) upstream.send(message as string);
      ws.data.queue = [];
    });
    upstream.addEventListener("message", (event) => {
      ws.send(event.data as string);
    });
    upstream.addEventListener("close", () => ws.close());
    upstream.addEventListener("error", () => ws.close());
  },
  message(ws, message) {
    const { upstream } = ws.data;
    if (upstream?.readyState === WebSocket.OPEN)
      upstream.send(message as string);
    else ws.data.queue.push(message);
  },
  close(ws) {
    ws.data.upstream?.close();
  },
};
