import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Page, test as base } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";

export { expect } from "@playwright/test";
export type { BrowserServer };

/** A server on a copy of the e2e fixture project. `seed` runs before the server starts. */
export async function served(
  options: { script?: Script; seed?: (s: BrowserServer) => void } = {},
) {
  const server = await startBrowserServer({ script: options.script });
  options.seed?.(server);
  await server.start();
  return server;
}

export const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});

export const jsonl = (...events: unknown[]) =>
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;

export const test = base.extend<{
  make: (
    options?: Parameters<typeof served>[0],
  ) => Promise<BrowserServer>;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs this pattern.
  make: async ({}, use) => {
    const all: BrowserServer[] = [];
    await use(async (options) => {
      const s = await served(options);
      all.push(s);
      return s;
    });
    for (const s of all) await s.dispose();
  },
});

export const leftPane = (page: Page) =>
  page.getByRole("region", { name: "Map pane" });
export const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });
export const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

export { appendFileSync, mkdirSync, writeFileSync, join };
