// Held-out steps 13.1, 13.2, 69.4: one server per project store.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { freshProject, type Project } from "../src/test/project.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

type Serve = { proc: Subprocess<"pipe", "pipe", "pipe">; out: Promise<string>; err: () => string; done: Promise<void> };

function serve(project: Project): Serve {
  const proc = project.start([process.execPath, CLI, "serve", "--port", "0"]);
  let err = "";
  const decoder = new TextDecoder();
  const done = (async () => {
    for await (const chunk of proc.stderr) err += decoder.decode(chunk);
  })();
  return { proc, out: new Response(proc.stdout).text(), err: () => err, done };
}

async function listening(lock: string, pid?: number): Promise<{ pid: number; port: number }> {
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const holder = JSON.parse(readFileSync(lock, "utf8"));
      if (typeof holder.port === "number" && (pid === undefined || holder.pid === pid)) return holder;
    } catch {}
    if (Date.now() > deadline) throw new Error("no server listened");
    await Bun.sleep(50);
  }
}

async function cards(project: Project, titles: string[]): Promise<void> {
  for (const [i, title] of titles.entries()) {
    const id = `c${i}`;
    const add = await project.werk(["add", id, "--title", title, ...(i === 0 ? [] : ["--parent", "c0"])]);
    expect(add.code).toBe(0);
    expect((await project.werk(["accept", id, "--actor", "you"])).code).toBe(0);
  }
}

test("13.1 a second server on the same store refuses while the first one runs", async () => {
  const project = freshProject();
  await cards(project, ["Alpha card", "Beta card", "Gamma card"]);
  const lock = join(project.dir, ".werk", "serve.lock");
  const starts = [serve(project), serve(project)];
  const holder = await listening(lock);
  const winner = starts.find((s) => s.proc.pid === holder.pid);
  const loser = starts.find((s) => s.proc.pid !== holder.pid);
  if (winner === undefined || loser === undefined) throw new Error("lock names neither start");
  const t0 = Date.now();
  expect(await loser.proc.exited).not.toBe(0);
  await loser.done;
  expect(Date.now() - t0).toBeGreaterThan(1000); // it waited
  expect(loser.err()).toContain(`pid ${holder.pid}`);
  expect(loser.err()).toContain(`port ${holder.port}`);
  expect(winner.proc.exitCode).toBeNull();
  const page = await (await fetch(`http://127.0.0.1:${holder.port}/map/c0`)).text();
  for (const t of ["Alpha card", "Beta card", "Gamma card"]) expect(page).toContain(t);
}, 30000);

test("13.2 a new server starts after a killed server left its lock behind", async () => {
  const project = freshProject();
  await cards(project, ["Alpha card", "Beta card"]);
  const lock = join(project.dir, ".werk", "serve.lock");
  const first = serve(project);
  await listening(lock);
  first.proc.kill("SIGKILL");
  await first.proc.exited;
  const t0 = Date.now();
  const second = serve(project);
  const holder = await listening(lock, second.proc.pid);
  expect(Date.now() - t0).toBeLessThan(4000); // no 5 s wait for the old server
  const page = await (await fetch(`http://127.0.0.1:${holder.port}/map/c0`)).text();
  expect(page).toContain("Alpha card");
  expect(page).toContain("Beta card");
}, 30000);

test("69.4 a second server on the same project waits, then refuses", async () => {
  const project = freshProject();
  await cards(project, ["Alpha card", "Beta card"]);
  const lock = join(project.dir, ".werk", "serve.lock");
  const first = serve(project);
  const holder = await listening(lock);
  const before = await (await fetch(`http://127.0.0.1:${holder.port}/map/c0`)).text();
  const t0 = Date.now();
  const second = serve(project);
  // The second server prints that it waits for the first server's pid, while it waits.
  await Bun.sleep(1500);
  const whileWaiting = second.err() + "";
  const code = await second.proc.exited;
  await second.done;
  const elapsed = Date.now() - t0;
  const failures: string[] = [];
  if (!(/wait/i.test(whileWaiting) && whileWaiting.includes(String(holder.pid))))
    failures.push(
      `no wait message naming pid ${holder.pid} while waiting; stderr so far: ${JSON.stringify(whileWaiting)}`,
    );
  if (code === 0) failures.push("second server exited 0");
  if (elapsed > 7000) failures.push(`stopped after ${elapsed} ms`);
  if (!second.err().includes(`pid ${holder.pid}`)) failures.push(`error lacks pid: ${second.err()}`);
  const after = await (await fetch(`http://127.0.0.1:${holder.port}/map/c0`)).text();
  if (!after.includes("Alpha card") || !after.includes("Beta card")) failures.push("first server lost cards");
  expect(before).toContain("Beta card");
  expect(failures).toEqual([]);
}, 30000);
