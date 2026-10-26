// Held-out steps 13.1 and 13.2: the lock of werk serve, driven as processes and HTTP.
import { expect, test } from "bun:test";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { freshProject, type Project } from "../src/test/project.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

type Serve = { proc: Subprocess<"pipe", "pipe", "pipe">; url: Promise<string | undefined>; err: Promise<string> };

function serve(p: Project): Serve {
  const proc = p.start([process.execPath, CLI, "serve", "--port", "0"]);
  const url = (async () => {
    const reader = proc.stdout.getReader();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return undefined;
      text += new TextDecoder().decode(value);
      const found = /http:\/\/\S+/.exec(text);
      if (found !== null) return found[0].replace(/\/map$/, "");
    }
  })();
  return { proc, url, err: new Response(proc.stderr).text() };
}

async function cards(p: Project, titles: string[]): Promise<void> {
  expect((await p.werk(["add", "root", "--title", titles[0] as string])).code).toBe(0);
  expect((await p.werk(["accept", "root", "--actor", "you"])).code).toBe(0);
  for (const [i, title] of titles.slice(1).entries()) {
    expect((await p.werk(["add", `c${i}`, "--title", title, "--parent", "root"])).code).toBe(0);
    expect((await p.werk(["accept", `c${i}`, "--actor", "you"])).code).toBe(0);
  }
}

test("13.1 a second server on the same store refuses while the first one runs", async () => {
  const p = freshProject();
  const titles = ["Alpha root card", "Beta child card", "Gamma child card"];
  await cards(p, titles);
  const t0 = Date.now();
  const starts = [serve(p), serve(p)];
  const urls = await Promise.all(starts.map((s) => s.url));
  const runningIdx = urls.findIndex((u) => u !== undefined);
  expect(urls.filter((u) => u !== undefined)).toHaveLength(1);
  const running = starts[runningIdx] as Serve;
  const other = starts[1 - runningIdx] as Serve;
  const url = urls[runningIdx] as string;
  expect(await other.proc.exited).not.toBe(0);
  // It waited before it stopped: the default wait is 5 s.
  expect(Date.now() - t0).toBeGreaterThan(4000);
  const message = await other.err;
  const port = new URL(url).port;
  expect(message).toContain(`pid ${running.proc.pid}`);
  expect(message).toContain(`port ${port}`);
  expect(running.proc.exitCode).toBeNull();
  const page = await (await fetch(`${url}/map`)).text();
  for (const title of titles) expect(page).toContain(title);
}, 30000);

test("13.2 a new server starts after a killed server left its lock behind", async () => {
  const p = freshProject();
  const titles = ["Alpha root card", "Beta child card"];
  await cards(p, titles);
  const first = serve(p);
  expect(await first.url).toBeDefined();
  first.proc.kill("SIGKILL");
  await first.proc.exited;
  const started = Date.now();
  const second = serve(p);
  const url = await second.url;
  expect(url).toBeDefined();
  // The default wait for a live holder is 5 s; a start with no wait listens well before that.
  expect(Date.now() - started).toBeLessThan(4000);
  const page = await (await fetch(`${url}/map`)).text();
  for (const title of titles) expect(page).toContain(title);
}, 30000);
