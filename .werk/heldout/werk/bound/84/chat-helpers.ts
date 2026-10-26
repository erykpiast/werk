import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { LAUNCHES_FILE, type LaunchEntry } from "../src/test/fake-script.ts";
import type { Werk } from "../e2e/project.ts";

export const stream = (event: object) => ({ event: { type: "stream_event", event } });
export const start = (id: string) => stream({ type: "message_start", message: { id } });
export const open = (text: string) =>
  stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
export const more = (text: string) =>
  stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
export const done = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
export const reply = (id: string, text: string) => [start(id), open(text), done(id, text)];
export const init = (session: string) => ({ event: { type: "system", subtype: "init", session_id: session } });
export const result = (extra: object = {}) => ({
  event: { type: "result", subtype: "success", is_error: false, result: "", duration_ms: 10, total_cost_usd: 0, ...extra },
});

export const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
export const turns = (p: Page) => pane(p).locator("[data-turn]");

export async function say(p: Page, words: string): Promise<void> {
  await pane(p).getByRole("textbox", { name: "Message" }).fill(words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}

let override: string | undefined;
export const useFake = (dir: string) => {
  override = dir;
};
export const fakeDir = (w: Werk) => override ?? join(w.dir, "..", "fake");

export function entries(w: Werk): LaunchEntry[] {
  const file = join(fakeDir(w), LAUNCHES_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LaunchEntry);
}

/** The text of every message the fake read, per launch. */
export function heard(w: Werk): string[][] {
  const launches: { pid: number; messages: string[] }[] = [];
  for (const entry of entries(w)) {
    if (entry.kind === "launch") launches.push({ pid: entry.pid, messages: [] });
    else if (entry.kind === "message") {
      const text = (entry.message as { message: { content: { text: string }[] } }).message.content[0]?.text ?? "";
      launches.find((each) => each.pid === entry.pid)?.messages.push(text);
    }
  }
  return launches.map((each) => each.messages);
}
export const launchArgs = (w: Werk) =>
  entries(w).flatMap((e) => (e.kind === "launch" ? [e.args] : []));
export const answers = (w: Werk) => entries(w).flatMap((e) => (e.kind === "answer" ? [e.answer] : []));
export const askLog = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "asks.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
