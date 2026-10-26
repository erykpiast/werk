import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { H } from "./lib.ts";

export function chat(h: H, name: string, lines: object[]) {
  mkdirSync(join(h.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(h.dir, ".werk", "chats", `${name}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}
export const msg = (kind: string, text: string, speaker = "person") => ({ speaker, at: "t", session: "s1", kind, text });
export function edge(h: H, from: string, to: string, type: string, why?: string) {
  h.seed("edge.added", { from, to, type, ...(why ? { why } : {}) });
}
export const types = (h: H) => h.events().map((e) => e.type);
