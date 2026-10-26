// Shared helpers of the held-out tests: a fresh project with a real root card, and CLI shortcuts.
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export { freshProject, type Project };

export const logPath = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project): string[] =>
  readFileSync(logPath(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
export const events = (p: Project): any[] => lines(p).map((l) => JSON.parse(l));

/** Append raw events (as a person's accepted map would hold them). */
export function seed(p: Project, list: { type: string; payload: object; actor?: string }[]): void {
  let n = lines(p).length;
  appendFileSync(
    logPath(p),
    list
      .map(
        (e) => `${JSON.stringify({ seq: ++n, at: "t", actor: e.actor ?? "you", type: e.type, payload: e.payload })}\n`,
      )
      .join(""),
  );
}

/** A real card node event. */
export const card = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...extra },
});

export function withRoot(): Project {
  const p = freshProject();
  seed(p, [card("root", "Root")]);
  return p;
}

/** Run werk; return the run (never throws). */
export const w = (p: Project, ...args: string[]) => p.werk(args);

/** Run werk and require exit 0. */
export async function ok(p: Project, ...args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}${r.out}`);
  return r;
}

/** Add a real card by proposing and accepting it. */
export async function real(p: Project, id: string, title: string, parent?: string, extra: string[] = []) {
  await ok(p, "add", id, "--title", title, ...(parent ? ["--parent", parent] : []), ...extra);
  await ok(p, "accept", id, "--actor", "you");
}

import { currentWerkArgv } from "../src/own/running.ts";

export type Served = {
  url: string;
  port: number;
  token: string;
  proc: ReturnType<Project["start"]>;
  post(path: string, body: object, headers?: Record<string, string>): Promise<Response>;
  get(path: string, headers?: Record<string, string>): Promise<Response>;
  err(): string;
};

/** Start `werk serve --port 0` in the project and read the page token. The harness stops it at test end. */
export async function serve(p: Project, extraArgs: string[] = []): Promise<Served> {
  const proc = p.start([...currentWerkArgv(), "serve", "--port", "0", ...extraArgs]);
  let errText = "";
  void (async () => {
    const reader = proc.stderr.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      errText += dec.decode(value);
    }
  })();
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let out = "";
  let url = "";
  while (url === "") {
    const { value, done } = await reader.read();
    if (done) throw new Error(`serve exited: ${errText}`);
    out += dec.decode(value);
    const m = /http:\/\/\S+/.exec(out);
    if (m) url = m[0].replace(/\/map$/, "");
  }
  const html = await (await fetch(`${url}/map`)).text();
  const token = /name="werk-token" content="([^"]+)"/.exec(html)?.[1] ?? "";
  const headers = (h?: Record<string, string>) => ({ "content-type": "application/json", "x-werk-token": token, ...h });
  return {
    url,
    port: Number(new URL(url).port),
    token,
    proc,
    post: (path, body, h) =>
      fetch(`${url}${path}`, { method: "POST", headers: headers(h), body: JSON.stringify(body) }),
    get: (path, h) => fetch(`${url}${path}`, { headers: h }),
    err: () => errText,
  };
}

import { mkdirSync, writeFileSync as wf } from "node:fs";

export const chatLine = (
  kind: string,
  text: string,
  speaker = "person",
  at = "2026-01-01T00:00:00Z",
  session = "sess1",
) => JSON.stringify({ speaker, at, session, kind, text });

/** Write a chat log `.werk/chats/<name>.jsonl`. */
export function chat(p: Project, name: string, rows: string[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  wf(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.join("\n")}\n`);
}

// ---- planning fixtures ----
import type { Step } from "../src/test/fake-script.ts";

export type { Step };

export const SPEC = `# Spec: checkout

## User stories

1. As a person, I want to pay.
2. As a person, I want to retry a payment.

## Test seams

The command line.
`;

export const SPEC3 = `# Spec: checkout

## User stories

1. As a person, I want to pay.
2. As a person, I want to retry a payment.
3. As a person, I want a receipt.

## Test seams

The command line.
`;

export const ticketText = (
  title: string,
  cites: string,
  blockedBy: string,
  stories: string,
  checks = "- `make test`",
) =>
  `title: ${title}\ncites: ${cites}\nblocked_by: ${blockedBy}\nstories: ${stories}\ntouches: checkout\n\n## What to build\n\nA person pays.\n\n## Acceptance criteria\n\n- It works.\n\n## Checks\n\n${checks}\n`;

export const edit = (path: string, content: string): Step => ({ edit: { path, content } });

/** A project whose map holds a decided subtree `checkout` over `checkout-cart` and `checkout-pay`, and a target. */
export async function planProject(extra: { type: string; payload: object }[] = []): Promise<Project> {
  const p = withRoot();
  const d = (id: string, parent: string) =>
    card(id, `Card ${id}`, { status: "decided", parent, who: "me", no_basis: "top", unchallenged: "none" });
  const kill = (id: string) => ({ type: "kill.added", payload: { id, criterion: { form: "revisit" } } });
  seed(p, [
    d("checkout", "root"),
    d("checkout-cart", "checkout"),
    d("checkout-pay", "checkout"),
    ...["checkout", "checkout-cart", "checkout-pay"].map(kill),
    ...extra,
  ]);
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  const t = await p.werk(["target", p.target]);
  if (t.code !== 0) throw new Error(`target: ${t.err}`);
  return p;
}

export const boardPath = (p: Project) => join(p.dir, ".werk", "board.jsonl");

// ---- a copy of the checkout, for tests that edit the repository ----
import { cpSync, mkdtempSync, readdirSync, symlinkSync, utimesSync, writeFileSync as wfs } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const CHECKOUT = fileURLToPath(new URL("..", import.meta.url));
const copies: string[] = [];

/** A copy of the checkout in a temporary folder, with its own git history and linked packages. */
export function copyRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-copy-")));
  copies.push(root);
  const skip = new Set(["node_modules", ".git", ".werk-heldout", "test-results", "dist", "coverage"]);
  cpSync(CHECKOUT, root, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => !skip.has(src.slice(CHECKOUT.length).split("/")[0] as string) || src === CHECKOUT,
  });
  mkdirSync(join(root, "node_modules"));
  for (const e of readdirSync(join(CHECKOUT, "node_modules"))) {
    if (e === ".vite" || e === ".vite-temp" || e === ".werk-installed") continue;
    symlinkSync(join(CHECKOUT, "node_modules", e), join(root, "node_modules", e));
  }
  const later = new Date(Date.now() + 5000);
  wfs(join(root, "node_modules", ".werk-installed"), "");
  utimesSync(join(root, "node_modules", ".werk-installed"), later, later);
  const g = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: root, stdout: "pipe", stderr: "pipe" });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "t");
  g("config", "user.email", "t@t");
  g("add", "-A");
  g("commit", "-qm", "snapshot");
  return root;
}

import { afterAll } from "bun:test";
import { rmSync } from "node:fs";

afterAll(() => {
  for (const c of copies.splice(0)) rmSync(c, { recursive: true, force: true });
});

/** Run a command in a folder with a clean-ish environment, capturing output. */
export function sh(cwd: string, cmd: string[], env: Record<string, string | undefined> = {}) {
  const r = Bun.spawnSync(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env } as Record<string, string>,
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}
