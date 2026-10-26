// Held-out binder E: server lock steps 13.1, 13.2, 69.4.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { freshProject, type Project } from "../src/test/project.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

type Serve = {
  proc: Subprocess<"pipe", "pipe", "pipe">;
  out: Promise<string>;
  errText(): string;
  err: Promise<string>;
};

function serve(project: Project): Serve {
  const proc = project.start([process.execPath, CLI, "serve", "--port", "0"]);
  let errText = "";
  const err = (async () => {
    const reader = proc.stderr.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      errText += dec.decode(value);
    }
    return errText;
  })();
  return { proc, out: new Response(proc.stdout).text(), err, errText: () => errText };
}

function seedCards(p: Project, titles: string[]): void {
  const log = join(p.dir, ".werk", "log.jsonl");
  let seq = 0;
  const add = (payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: ++seq, at: "t", actor: "you", type: "node.added", payload })}\n`);
  add({ id: "root", kind: "card", title: titles[0], status: "decided" });
  titles
    .slice(1)
    .forEach((title, i) => add({ id: `c${i + 1}`, kind: "card", title, parent: "root", status: "decided" }));
}

async function listening(lock: string, pid?: number): Promise<{ pid: number; port: number }> {
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const holder = JSON.parse(readFileSync(lock, "utf8"));
      if (typeof holder.port === "number" && (pid === undefined || holder.pid === pid)) return holder;
    } catch {
      // not yet
    }
    if (Date.now() > deadline) throw new Error("the server did not start");
    await Bun.sleep(50);
  }
}

test("13.1", async () => {
  const p = freshProject();
  const titles = ["Alpha root card", "Bravo child card", "Charlie child card"];
  seedCards(p, titles);
  const lock = join(p.dir, ".werk", "serve.lock");
  const starts = [serve(p), serve(p)];
  const holder = await listening(lock);
  const winner = starts.find((s) => s.proc.pid === holder.pid);
  const loser = starts.find((s) => s.proc.pid !== holder.pid);
  if (winner === undefined || loser === undefined) throw new Error("lock names neither start");
  const started = Date.now();
  const code = await loser.proc.exited;
  const waited = Date.now() - started;
  expect(code).not.toBe(0);
  expect(waited).toBeGreaterThan(1000);
  const msg = await loser.err;
  expect(msg).toContain(String(holder.pid));
  expect(msg).toContain(String(holder.port));
  expect(winner.proc.exitCode).toBeNull();
  const page = await fetch(`http://127.0.0.1:${holder.port}/map`);
  expect(page.status).toBe(200);
  const html = await page.text();
  // The root page shows the root title and the tiles of its two children.
  for (const t of titles) expect(html).toContain(t);
}, 30000);

test("13.2", async () => {
  const p = freshProject();
  const titles = ["Delta root card", "Echo child card"];
  seedCards(p, titles);
  const lock = join(p.dir, ".werk", "serve.lock");
  const first = serve(p);
  await listening(lock);
  first.proc.kill("SIGKILL");
  await first.proc.exited;
  const started = Date.now();
  const second = serve(p);
  const holder = await listening(lock, second.proc.pid);
  // Without a wait for the old server: the 5 s lock wait must not be spent.
  expect(Date.now() - started).toBeLessThan(4000);
  expect(second.proc.exitCode).toBeNull();
  const html = await (await fetch(`http://127.0.0.1:${holder.port}/map`)).text();
  for (const t of titles) expect(html).toContain(t);
}, 30000);

test("69.4", async () => {
  const p = freshProject();
  const titles = ["Foxtrot root card", "Golf child card"];
  seedCards(p, titles);
  const lock = join(p.dir, ".werk", "serve.lock");
  const first = serve(p);
  const holder = await listening(lock);
  const before = await (await fetch(`http://127.0.0.1:${holder.port}/map`)).text();
  const started = Date.now();
  const second = serve(p);
  // While it waits, the second server prints that it waits for the first server's pid.
  await Bun.sleep(2000);
  const during = second.errText() + "";
  const stillWaiting = second.proc.exitCode === null;
  const code = await second.proc.exited;
  const took = Date.now() - started;
  const err = await second.err;
  const out = await second.out;
  expect(code).not.toBe(0);
  expect(took).toBeLessThan(8000);
  expect(err).toContain(`pid ${holder.pid}`);
  expect(first.proc.exitCode).toBeNull();
  const after = await (await fetch(`http://127.0.0.1:${holder.port}/map`)).text();
  for (const t of titles) expect(after).toContain(t);
  expect(before.includes(titles[1])).toBe(true);
  // The waiting message check, last so the other checks report first.
  expect({ stillWaiting, printedWhileWaiting: (during + out).includes(String(holder.pid)) }).toEqual({
    stillWaiting: true,
    printedWhileWaiting: true,
  });
}, 30000);
