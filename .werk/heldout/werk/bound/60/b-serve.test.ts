// Held-out steps 13.1 and 13.2: the lock of werk serve.
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

function seed(p: Project, cards: [string, string][]): void {
  const lines = cards.map(([id, title], i) =>
    JSON.stringify({ seq: i + 1, at: "t", actor: "you", type: "node.added", payload: { id, kind: "card", title, ...(i ? { parent: "root" } : {}) } }),
  );
  writeFileSync(join(p.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

async function firstLine(proc: ReturnType<Project["start"]>): Promise<string> {
  const reader = proc.stdout.getReader();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return text;
}

test("13.1", async () => {
  const p = freshProject();
  seed(p, [["root", "Root card one"], ["alpha", "Alpha card two"], ["beta", "Beta card three"]]);
  const a = p.start([process.execPath, CLI, "serve", "--port", "0"]);
  const b = p.start([process.execPath, CLI, "serve", "--port", "0"]);
  const outcome = await Promise.race([
    a.exited.then((code) => ({ loser: a, winner: b, code })),
    b.exited.then((code) => ({ loser: b, winner: a, code })),
  ]);
  expect(outcome.code).not.toBe(0);
  const err = await new Response(outcome.loser.stderr).text();
  expect(err).toContain(`pid ${outcome.winner.pid}`);
  const line = await firstLine(outcome.winner);
  const url = /http:\/\/\S+/.exec(line)?.[0] as string;
  const port = new URL(url).port;
  expect(err).toContain(port);
  expect(outcome.winner.exitCode).toBeNull();
  const html = await (await fetch(url)).text();
  for (const t of ["Root card one", "Alpha card two", "Beta card three"]) expect(html).toContain(t);
}, 30000);

test("13.2", async () => {
  const p = freshProject();
  seed(p, [["root", "Root card one"], ["alpha", "Alpha card two"]]);
  const a = p.start([process.execPath, CLI, "serve", "--port", "0"]);
  await firstLine(a);
  a.kill("SIGKILL");
  await a.exited;
  const t0 = Date.now();
  const b = p.start([process.execPath, CLI, "serve", "--port", "0"]);
  const line = await firstLine(b);
  expect(Date.now() - t0).toBeLessThan(3000);
  const url = /http:\/\/\S+/.exec(line)?.[0] as string;
  const html = await (await fetch(url)).text();
  expect(html).toContain("Root card one");
  expect(html).toContain("Alpha card two");
}, 30000);
