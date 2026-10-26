import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";

export const say = (
  id: string,
  text: string,
  usage?: Record<string, number>,
) => ({
  event: {
    type: "assistant",
    message: {
      id,
      content: [{ type: "text", text }],
      ...(usage ? { usage } : {}),
    },
  },
});

export const tasks = (ids: string[]) => ({
  event: {
    type: "system",
    subtype: "background_tasks",
    tasks: ids.map((id) => ({ id })),
  },
});

export async function withChat(
  script: Script,
  body: (server: BrowserServer) => Promise<void>,
  setup?: (server: BrowserServer) => void,
) {
  const server = await startBrowserServer({ script });
  setup?.(server);
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

export const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

export const launched = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));

/** Overwrites the stored session id of the project, as another Claude Code would leave it. */
export function storeSession(server: BrowserServer, id: string) {
  mkdirSync(join(server.dir, ".werk"), { recursive: true });
  writeFileSync(join(server.dir, ".werk", "session"), `${id}\n`);
}

export const arg = (args: string[], flag: string) =>
  args[args.indexOf(flag) + 1];
