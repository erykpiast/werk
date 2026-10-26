import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { type BrowserServer, startBrowserServer } from "../../e2e/support/server.ts";
import type { Script } from "../../src/fake-agent/script.ts";

export const say = (id: string, text: string, usage?: object) => ({
  event: {
    type: "assistant",
    message: {
      id,
      content: [{ type: "text", text }],
      ...(usage ? { usage } : {}),
    },
  },
});

export async function withServer(
  script: Script,
  body: (server: BrowserServer) => Promise<void>,
) {
  const server = await startBrowserServer({ script });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

export const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });

export async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}

export const launchArgs = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));

export const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

export const sessionFile = (server: BrowserServer) =>
  join(server.dir, ".werk", "session");

export const readSession = (server: BrowserServer) =>
  readFileSync(sessionFile(server), "utf8").trim();
export const writeSession = (server: BrowserServer, id: string) =>
  writeFileSync(sessionFile(server), `${id}\n`);
