// Starts werk in a fresh project with the given cards and gives its base URL.
// werk has no documented way to add cards or serve the map; this tries the verbs a person would use.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(new URL(".", import.meta.url).pathname, "..", "src", "cli.ts");

export type Card = { id: string; body?: string; summary?: string; removed?: boolean };
export type App = { url: string; stop(): void; log: string[] };

function werk(dir: string, args: string[]): { code: number | null; out: string } {
  const run = spawnSync("bun", [CLI, ...args], { cwd: dir, encoding: "utf8" });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

export async function startWerk(cards: Card[]): Promise<App> {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-15-"));
  spawnSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: dir });
  const log: string[] = [];
  for (const card of cards) {
    const args = ["card", "add", card.id];
    if (card.summary !== undefined) args.push("--summary", card.summary);
    if (card.body !== undefined) args.push("--body", card.body);
    const r = werk(dir, args);
    log.push(`werk ${args.slice(0, 3).join(" ")} -> exit ${r.code}: ${r.out.split("\n")[0]}`);
    if (r.code !== 0) throw new Error(`cannot create card ${card.id}: ${log.at(-1)}`);
    if (card.removed) werk(dir, ["card", "remove", card.id]);
  }
  const port = 40000 + Math.floor(Math.random() * 20000);
  const child: ChildProcess = spawn("bun", [CLI, "serve", "--port", String(port)], { cwd: dir });
  let out = "";
  child.stdout?.on("data", (d) => (out += d));
  child.stderr?.on("data", (d) => (out += d));
  const exited = new Promise<void>((r) => child.on("exit", () => r()));
  const url = `http://localhost:${port}`;
  const up = (async () => {
    for (;;) {
      try {
        await fetch(url);
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  })();
  const ok = await Promise.race([up, exited.then(() => false), new Promise((r) => setTimeout(() => r(false), 15000))]);
  if (!ok) {
    child.kill();
    throw new Error(`werk serve did not start: ${out.split("\n")[0]}`);
  }
  return { url, log, stop: () => child.kill() };
}
