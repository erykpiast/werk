// Held-out steps 67.1-67.5: a quote from a recorded session becomes a ghost excerpt.
// The recorded session is the conversation's chat log in the map's folder, as werk quote reads it.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { make, type P } from "./lib.ts";

const line = (speaker: string, text: string, kind = "spoken") =>
  JSON.stringify({ speaker, at: "2026-10-01T10:00:00Z", session: "rec-1", kind, text });

function session(p: P, lines: string[]): string {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  const file = join(p.dir, ".werk", "chats", "rec.jsonl");
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

function base(p: P): void {
  p.card("root", { title: "Root", status: "decided", who: "me" });
  p.card("werk-excerpt", { title: "Excerpts", parent: "root" });
}

test("67.1 a quote found once becomes a ghost excerpt on the citing card", async () => {
  const p = make();
  base(p);
  const text = "Every quote in the imported map was written from memory";
  session(p, [line("assistant", "hello"), line("user", text)]);
  const r = await p.w("quote", "#werk-excerpt", "rec", "written from memory");
  expect(r.code).toBe(0);
  const id = p.events().at(-1).payload.id as string;
  const ex = await p.w("show", id);
  expect(ex.out.split("\n")[0]).toContain("proposed");
  const start = text.indexOf("written from memory");
  expect(ex.out).toContain("rec-1");
  expect(ex.out).toContain("message: 1");
  expect(ex.out).toContain("speaker: user");
  expect(ex.out).toContain(`span: ${start}..${start + 19}`);
  const card = await p.w("show", "werk-excerpt");
  expect(card.out).toMatch(new RegExp(`supported_by\\s+${id}`));
});

test("67.2 the excerpt lets the person find the quote again in the transcript", async () => {
  const p = make();
  base(p);
  const file = session(p, [
    line("user", "what does the tool do on doubt?"),
    line("assistant", "On doubt the tool never guesses and stops."),
  ]);
  expect((await p.w("quote", "werk-excerpt", "rec", "the tool never guesses")).code).toBe(0);
  const id = p.events().at(-1).payload.id as string;
  const out = (await p.w("show", id)).out;
  const msg = Number(/message: (\d+)/.exec(out)?.[1]);
  const [, s, e] = /span: (\d+)\.\.(\d+)/.exec(out) ?? [];
  const speaker = /speaker: (\S+)/.exec(out)?.[1];
  const rec = JSON.parse(readFileSync(file, "utf8").split("\n")[msg] as string);
  expect(rec.text.slice(Number(s), Number(e))).toBe("the tool never guesses");
  expect(rec.speaker).toBe("assistant");
  expect(speaker).toBe("assistant");
});

test("67.3 a quote with one changed character fails and changes nothing", async () => {
  const p = make();
  base(p);
  session(p, [line("assistant", "the tool never guesses")]);
  const n = p.lines().length;
  const r = await p.w("quote", "werk-excerpt", "rec", "the tool never gueses");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no exact match/);
  expect(p.lines().length).toBe(n);
  expect((await p.w("show", "werk-excerpt")).out).not.toContain("supported_by");
});

test("67.4 a quote that occurs in two messages fails and names both messages", async () => {
  const p = make();
  base(p);
  const lines = Array.from({ length: 9 }, (_, i) => line(i % 2 ? "user" : "assistant", `filler ${i}`));
  lines[3] = line("assistant", "the tool fails instead of guessing");
  lines[7] = line("user", "good: it fails instead of guessing");
  session(p, lines);
  const n = p.lines().length;
  const r = await p.w("quote", "werk-excerpt", "rec", "fails instead of guessing");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/\b3\b/);
  expect(r.err).toMatch(/\b7\b/);
  expect(p.lines().length).toBe(n);
  expect((await p.w("show", "werk-excerpt")).out).not.toContain("supported_by");
});

test("67.5 a ghost excerpt is accepted the same way as every other ghost", async () => {
  const p = make();
  base(p);
  session(p, [line("user", "accept me like any ghost")]);
  expect((await p.w("quote", "werk-excerpt", "rec", "like any ghost")).code).toBe(0);
  const id = p.events().at(-1).payload.id as string;
  expect((await p.w("accept", id, "--actor", "you")).code).toBe(0);
  const ex = await p.w("show", id);
  expect(ex.out.split("\n")[0]).not.toContain("proposed");
  const card = await p.w("show", "werk-excerpt");
  expect(card.out).toMatch(new RegExp(`supported_by\\s+${id}`));
  expect(card.out).not.toMatch(new RegExp(`${id}.*held`));
});
