import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { P } from "./cli.ts";

/** First line of show output: the head with kind, id, status and marks. */
export const head = (p: P, id: string) => p.werk("show", id).out.split("\n")[0] ?? "";
export const isGhost = (p: P, id: string) => /\bproposed\b/.test(head(p, id));

/** Writes a chat log for a conversation. */
export function chat(p: P, name: string, lines: object[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
}

/** Lines of show output listing a link to/from `other`. */
export const linkLine = (out: string, type: string, other: string) =>
  out.split("\n").find((l) => new RegExp(`^\\s+(->|<-)\\s+${type}\\s+${other.replace(/[:]/g, "\\:")}\\s`).test(l));
