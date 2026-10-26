import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decidedCard, harness, writeLog, YOU } from "./util.ts";

const { project, werk } = harness();
const SLOW = 60_000;

const freePort = () =>
  new Promise<number>((res) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });

async function serve() {
  const port = await freePort();
  project().start(["bun", join(import.meta.dir, "..", "..", "src", "cli.ts"), "serve", "--port", String(port)], { WERK_DEV: "1" });
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 300; i++) {
    if ((await fetch(`${origin}/api/projects`).catch(() => null))?.ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return async (card: string) => {
    const res = await fetch(`${origin}/api/projects/project/open?card=${card}`);
    return (await res.json()) as { html?: string };
  };
}

function chat() {
  const dir = join(project().dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "talk.jsonl"), JSON.stringify({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "we charge per seat" }) + "\n");
}

test("06.1 a new excerpt stages as a ghost and waits for the check mark", async () => {
  writeLog(project(), decidedCard("x"));
  chat();
  const q = await werk("quote", "x", "talk", "we charge per seat");
  expect(q.stdout).toContain("proposed");
  expect(q.stdout).not.toContain("added");
  const open = await serve();
  const html = (await open("x")).html ?? "";
  expect(html).toContain('data-card-id="x:ex0"');
  expect(html).toContain("tag-pending-link");
  const at = html.indexOf('data-card-id="x:ex0"');
  const li = html.slice(html.lastIndexOf("<li", at), at);
  expect(li).toMatch(/ghost|proposed/);
  const shown = (await werk("show", "x")).stdout;
  expect(shown).toContain("[decided]");
  expect(shown).toContain("Title x");
  expect((await werk("show", "x:ex0")).stdout).toContain("proposed");
}, SLOW);

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  writeLog(project(), decidedCard("x"));
  chat();
  await werk("quote", "x", "talk", "we charge per seat");
  const open = await serve();
  expect(((await open("x")).html ?? "")).toContain("tag-pending-link");
  const acc = await werk("accept", "x:ex0", ...YOU);
  expect(acc.code).toBe(0);
  const shown = (await werk("show", "x:ex0")).stdout;
  expect(shown).not.toMatch(/\]\s+proposed/);
  const html = (await open("x")).html ?? "";
  expect(html).toContain("Evidence and excerpts");
  expect(html).toContain('data-card-id="x:ex0"');
  expect(html).not.toContain("tag-pending-link");
  expect((await werk("show", "x")).stdout).toContain("Say:\n  person: we charge per seat");
  expect((await werk("show", "x")).stdout).not.toMatch(/Say:[^]*proposed/);
}, SLOW);
