import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readRecords } from "../../src/fake-agent/launch-log.ts";

const BIN = resolve(import.meta.dir, "../../fake/claude");
let root: string;
let project: string;
let scriptPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "heldout-fake-"));
  project = join(root, "project");
  mkdirSync(project);
  scriptPath = join(root, "script.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const install = (s: unknown) => writeFileSync(scriptPath, JSON.stringify(s));
const msg = (t: string) => `${JSON.stringify({ type: "user", message: { role: "user", content: t } })}\n`;
const ans = (id: string, behavior: string) =>
  `${JSON.stringify({ type: "control_response", response: { request_id: id, response: { behavior } } })}\n`;

function launch(role: string | undefined, args: string[] = [], script = true) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (script) env.WERK_FAKE_SCRIPT = scriptPath;
  if (role) env.WERK_AGENT_ROLE = role;
  const child = Bun.spawn(["bun", BIN, ...args], { cwd: project, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const lines: string[] = [];
  const waiters: (() => void)[] = [];
  const reading = (async () => {
    const dec = new TextDecoder();
    let rest = "";
    for await (const c of child.stdout) {
      rest += dec.decode(c, { stream: true });
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      lines.push(...parts);
      for (const w of waiters.splice(0)) w();
    }
    for (const w of waiters.splice(0)) w();
  })();
  const sink = child.stdin as import("bun").FileSink;
  return {
    child,
    lines,
    send(l: string) { sink.write(l); sink.flush(); },
    end() { sink.end(); },
    async waitFor(n: number) {
      while (lines.length < n && child.exitCode === null) await new Promise<void>((w) => waiters.push(w));
    },
    async finish() {
      const code = await child.exited;
      await reading;
      return { code, out: lines.map((l) => JSON.parse(l)), err: await new Response(child.stderr).text() };
    },
  };
}
const text = (t: string) => ({ event: { type: "assistant", message: { content: [{ type: "text", text: t }] } } });

test("03.1 roles get their own scripted replies, whatever the prompt says", async () => {
  install({
    roles: {
      builder: { replies: [[{ edit: "note.md", content: "a note" }, text("BUILT")]] },
      grader: { replies: [[text("GRADED")]] },
    },
  });
  const b = launch("builder", ["--print", "--model", "x"]);
  b.send(msg("Build the ticket"));
  b.end();
  const built = await b.finish();
  const g = launch("grader", ["--print", "--tools", "Read"]);
  g.send(msg("Grade the ticket"));
  g.end();
  const graded = await g.finish();
  expect(built.code).toBe(0);
  expect(JSON.stringify(built.out)).toContain("BUILT");
  expect(readFileSync(join(project, "note.md"), "utf8")).toBe("a note");
  expect(JSON.stringify(graded.out)).toContain("GRADED");
  expect(JSON.stringify(graded.out)).not.toContain("BUILT");
  const launches = readRecords(`${scriptPath}.launches.jsonl`).filter((r) => r.kind === "launch");
  expect(launches.map((l) => l.role)).toEqual(["builder", "grader"]);
  expect(launches[0].args).toEqual(["--print", "--model", "x"]);
  expect(launches[1].args).toEqual(["--print", "--tools", "Read"]);
});

test("03.2 a chat answers two messages and ends when its input closes", async () => {
  install({ roles: { chat: { replies: [[text("first")], [text("second")]] } } });
  const c = launch("chat");
  c.send(msg("one"));
  await c.waitFor(3); // init, reply, result
  expect(c.lines.join("\n")).toContain("first");
  expect(c.child.exitCode).toBeNull();
  c.send(msg("two"));
  await c.waitFor(5);
  expect(c.lines.join("\n")).toContain("second");
  expect(c.child.exitCode).toBeNull();
  c.end();
  const done = await c.finish();
  expect(done.code).toBe(0);
});

test("03.3 a crash after an open ask prints no final result", async () => {
  install({
    roles: {
      builder: {
        replies: [[
          { ask: { id: "ask-1", tool: "Bash", input: { command: "ls" } } },
          { pause: 50 },
          text("after the ask"),
          { crash: 7 },
        ]],
      },
    },
  });
  const b = launch("builder");
  b.send(msg("go"));
  // No answer is sent to the ask.
  const done = await b.finish();
  const types = done.out.map((e) => e.type);
  expect(types).toContain("control_request");
  expect(JSON.stringify(done.out)).toContain("after the ask");
  expect(types.indexOf("control_request")).toBeLessThan(JSON.stringify(done.out.map((e) => e.type)).length);
  expect(types).not.toContain("result");
  expect(JSON.stringify(done.out)).not.toContain("tool_result");
  expect(done.code).toBe(7);
});

test("03.4 a build with an ask ends after one reply, and a bad edit path changes nothing", async () => {
  const outside = join(root, "outside.txt");
  writeFileSync(outside, "known");
  install({
    roles: {
      builder: {
        exit: 5,
        replies: [[
          { ask: { id: "ask-1", tool: "Bash" } },
          { edit: "../outside.txt", content: "changed" },
        ]],
      },
    },
  });
  const b = launch("builder");
  b.send(msg("go"));
  const asked = b.waitFor(1);
  const early = await Promise.race([asked.then(() => "line"), b.child.exited.then(() => "exit")]);
  if (early === "line") b.send(ans("ask-1", "allow"));
  const done = await b.finish();
  expect(done.out.map((e) => e.type)).toContain("control_request");
  expect(done.code).toBe(5);
  // The reply is not played: the edit step is reported as failed by the agent.
  expect(done.err.toLowerCase()).toMatch(/edit|outside/);
  expect(readFileSync(outside, "utf8")).toBe("known");
});

test("03.5 with no script the fake agent fails at once", async () => {
  const a = launch("builder", [], false);
  a.send(msg("go"));
  const done = await a.finish();
  expect(done.code).not.toBe(0);
  expect(done.err).toContain("no script");
  expect(done.out.length).toBe(0);
  expect(existsSync(`${scriptPath}.launches.jsonl`)).toBe(false);
});
