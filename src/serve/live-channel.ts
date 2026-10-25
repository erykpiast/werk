/** The live channel: one event stream for each open page. A map signal carries no data (#werk-write-changed). The chat parts carry JSON (#werk-progress). */
export type Clients = Set<ReadableStreamDefaultController<Uint8Array>>;

export type LiveEvent = "changed" | "measure" | "board" | "reload";

const encoder = new TextEncoder();

/** The response of one page's live channel. The page is a client until it disconnects. */
export function live(ctx: { clients: Clients }): Response {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      ctx.clients.add(c);
      c.enqueue(encoder.encode(": live\n\n"));
    },
    cancel() {
      ctx.clients.delete(controller);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
    },
  });
}

/** Sends one bare signal to every open page. A page that cannot take it is dropped. */
export function broadcast(clients: Clients, event: LiveEvent): void {
  const bytes = encoder.encode(`event: ${event}\ndata:\n\n`);
  for (const client of clients) {
    try {
      client.enqueue(bytes);
    } catch {
      clients.delete(client);
    }
  }
}

/** Sends one chat part, with its data as one line of JSON, to every open page. */
export function broadcastData(
  clients: Clients,
  event: string,
  data: unknown,
): void {
  const bytes = encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
  for (const client of clients) {
    try {
      client.enqueue(bytes);
    } catch {
      clients.delete(client);
    }
  }
}
