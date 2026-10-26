import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../e2e/support/server.ts";

export const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});

export function card(id: string, title: string) {
  return `${JSON.stringify({ type: "node.proposed", id, kind: "card", title, status: "open", parent: "root" })}\n${JSON.stringify({ type: "node.accepted", id, actor: "you" })}\n`;
}

export async function withServer(
  script: Script,
  cards: [string, string][],
  body: (server: BrowserServer) => Promise<void>,
) {
  const server = await startBrowserServer({ script });
  for (const [id, title] of cards)
    appendFileSync(join(server.dir, ".werk", "log.jsonl"), card(id, title));
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

export const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });
export const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message" });

export async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

export const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

/** A 1x1 PNG. */
export const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
