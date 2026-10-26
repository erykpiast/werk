// Shared helpers of the g- held-out browser tests: fake agent script steps, pane locators, launch records.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { LAUNCHES_FILE, type LaunchEntry } from "../src/test/fake-script.ts";

export const stream = (event: object) => ({ event: { type: "stream_event", event } });
export const start = (id: string) => stream({ type: "message_start", message: { id } });
export const open = (text: string) =>
  stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
export const more = (text: string) =>
  stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
export const done = (id: string, text: string, usage?: object) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) } },
});
export const reply = (id: string, text: string) => [start(id), open(text), done(id, text)];
export const init = (session: string) => ({ event: { type: "system", subtype: "init", session_id: session } });

export const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
export const turns = (p: Page) => pane(p).locator("[data-turn]");
export const box = (p: Page) => pane(p).getByRole("textbox", { name: "Message" });

export async function say(p: Page, words: string): Promise<void> {
  await box(p).fill(words);
  await box(p).press("Enter");
}

export type L = { pid: number; args: string[]; role: string; messages: string[]; answers: unknown[] };

export function launches(fakeDir: string): L[] {
  const file = join(fakeDir, LAUNCHES_FILE);
  if (!existsSync(file)) return [];
  const out: L[] = [];
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const e = JSON.parse(line) as LaunchEntry;
    if (e.kind === "launch") out.push({ pid: e.pid, args: e.args, role: e.role, messages: [], answers: [] });
    else {
      const l = out.findLast((x) => x.pid === e.pid);
      if (e.kind === "message") {
        const m = e.message as { message: { content: { text?: string }[] | string } };
        const c = m.message.content;
        l?.messages.push(typeof c === "string" ? c : (c[0]?.text ?? ""));
      } else l?.answers.push(e.answer);
    }
  }
  return out;
}

export function askLog(dir: string): Record<string, unknown>[] {
  const f = join(dir, ".werk", "asks.jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
