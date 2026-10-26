import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";

export const say = (id: string, text: string, inputTokens = 0) => ({
  event: {
    type: "assistant",
    message: {
      id,
      content: [{ type: "text", text }],
      ...(inputTokens > 0 ? { usage: { input_tokens: inputTokens } } : {}),
    },
  },
});

export async function withChat(
  script: Script,
  body: (server: BrowserServer) => Promise<void>,
  options: { env?: Record<string, string> } = {},
) {
  const server = await startBrowserServer({ script, ...options });
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
