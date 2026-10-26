import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../../src/test-env/env.ts";

type Werk = (...a: string[]) => { code: number; stdout: string; stderr: string };

/** Makes a card real: add, then accept (status open). */
export function real(werk: Werk, id: string, parent: string, title = `Card ${id}`, status = "open") {
  const added = werk("add", id, "--title", title, "--parent", parent, "--why", "w", "--status", status);
  if (added.code !== 0) throw new Error(`add ${id}: ${added.stderr}`);
  const acc = werk("accept", id, "--actor", "you");
  if (acc.code !== 0) throw new Error(`accept ${id}: ${acc.stderr}`);
}

/** Decides a real card through the contract facts. */
export function decide(werk: Werk, id: string) {
  for (const args of [
    ["edit", id, "--who", "me"],
    ["edit", id, "--no-basis", "x"],
    ["edit", id, "--unchallenged", "x"],
    ["kill", id, "--revisit"],
    ["status", id, "decided"],
  ]) {
    const r = werk(...args);
    if (r.code !== 0) throw new Error(`${args.join(" ")}: ${r.stderr}`);
  }
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const probe = createServer();
    probe.once("error", rej);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => res(port));
    });
  });
}

/** Like startBrowserServer with appCopy, but it exposes the server output. */
export async function startCopyServer() {
  const env = { ...cleanEnv(process.env), WERK_OPEN: "true" };
  if (!fakeIsFirst(env.PATH)) throw new Error("fake agent not first");
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-"));
  const dir = join(root, "project");
  cpSync(join(resolve(import.meta.dirname, "..", "..", "e2e", "fixtures", "project")), dir, {
    recursive: true,
  });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const home = join(root, "home");
  const appDir = join(root, "app");
  const cli = copyApp(appDir);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let output = "";
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", String(port)], {
    cwd: dir,
    env: { ...env, WERK_DEV: "1", WERK_HOME: home },
  });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
  const end = Date.now() + 40000;
  for (;;) {
    const ok = await fetch(`${origin}/api/projects`).then((r) => r.ok, () => false);
    if (ok) break;
    if (Date.now() > end) throw new Error(`server did not start:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  const werk: Werk = (...args) => {
    const r = spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" });
    return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  };
  return {
    url: `${origin}/p/${basename(dir)}`,
    origin,
    port,
    appDir,
    werk,
    output: () => output,
    listenerPid: () =>
      spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim(),
    async dispose() {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      rmSync(root, { recursive: true, force: true });
    },
  };
}
