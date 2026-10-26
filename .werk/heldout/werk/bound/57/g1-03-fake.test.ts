import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanEnv } from "../src/test-env/env.ts";
import { readRecords } from "../src/fake-agent/launch-log.ts";
import type { Script } from "../src/fake-agent/script.ts";

const BIN = join(import.meta.dir, "../fake/claude");
let dir: string;
let project: string;
let scriptPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-heldout-fake-"));
  project = join(dir, "project");
  mkdirSync(project);
  scriptPath = join(dir, "script.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const install = (s: Script) => writeFileSync(scriptPath, JSON.stringify(s));

function launch(role: string | undefined, args: string[] = [], withScript = true) {
  const env: Record<string, string> = { ...cleanEnv(process.env) };
  if (withScript) env.WERK_FAKE_SCRIPT = scriptPath;
  if (role) env.WERK_AGENT_ROLE = role;
  const child = Bun.spawn(["bun", BIN, ...args], { cwd: project, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const lines: string[] = [];
  const waiters: (() => void)[] = [];
  void (async () => {
    const dec = new TextDecoder();
    let rest = "";
    for await (const chunk of child.stdout) {
      rest += dec.decode(chunk, { stream: true });
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      lines.push(...parts);
      for (const w of waiters.splice(0)) w();
    }
    for (const w of waiters.splice(0)) w();
  })();
  const sink = child.stdin as import("bun").FileSink;
  const msg = (t: string) => `${JSON.stringify({ type: "user", message: { role: "user", content: t } })}\n`;
  return {
    child,
    lines,
    say(t: string) { sink.write(msg(t)); sink.flush(); },
    send(l: string) { sink.write(l); sink.flush(); },
    close() { sink.end(); },
    async waitFor(n: number) {
      const end = Date.now() + 10000;
      while (lines.length < n && Date.now() < end) await new Promise<void>((w) => { waiters.push(w); setTimeout(w, 200); });
    },
    async finish() {
      const code = await child.exited;
      await new Promise((r) => setTimeout(r, 50));
      return { code, stdout: lines.map((l) => JSON.parse(l)), stderr: await new Response(child.stderr).text() };
    },
  };
}
const allow = (id: string) => `${JSON.stringify({ type: "control_response", response: { request_id: id, response: { behavior: "allow" } } })}\n`;

test("03.1 roles get their own replies whatever the prompt says", async () => {
  install({
    roles: {
      builder: { replies: [[{ edit: "note.txt", content: "hello" }, { event: { type: "assistant", text: "B" } }]] },
      grader: { replies: [[{ event: { type: "assistant", text: "G" } }]] },
    },
  });
  const b = launch("builder", ["--print", "x"]);
  b.say("Build the ticket");
  const built = await b.finish();
  expect(built.code).toBe(0);
  expect(built.stdout[0]).toEqual({ type: "assistant", text: "B" });
  expect(readFileSync(join(project, "note.txt"), "utf8")).toBe("hello");
  const g = launch("grader", ["--print", "y"]);
  g.say("Grade it");
  const graded = await g.finish();
  expect(graded.stdout[0]).toEqual({ type: "assistant", text: "G" });
  const launches = readRecords(`${scriptPath}.launches.jsonl`).filter((r) => r.kind === "launch");
  expect(launches.map((l) => l.role)).toEqual(["builder", "grader"]);
  expect((launches[0] as { args: string[] }).args).toEqual(["--print", "x"]);
  expect((launches[1] as { args: string[] }).args).toEqual(["--print", "y"]);
});

test("03.2 a chat answers two messages and ends when input closes", async () => {
  install({ roles: { chat: { replies: [[{ event: { r: 1 } }], [{ event: { r: 2 } }]] } } });
  const c = launch("chat");
  c.say("M1");
  await c.waitFor(3);
  expect(c.lines.some((l) => JSON.parse(l).r === 1)).toBe(true);
  expect(c.child.exitCode).toBeNull();
  c.say("M2");
  await c.waitFor(5);
  expect(c.lines.some((l) => JSON.parse(l).r === 2)).toBe(true);
  c.close();
  const done = await c.finish();
  expect(done.code).toBe(0);
});

test("03.3 a crash after an open ask prints no tool result and no final result", async () => {
  install({
    roles: {
      builder: {
        replies: [[{ ask: { id: "a1", tool: "Bash" } }, { event: { after: true } }, { pause: 50 }, { crash: 9 }]],
      },
    },
  });
  const b = launch("builder");
  b.say("go");
  await b.waitFor(2);
  const first = JSON.parse(b.lines[0] as string);
  expect(first.type).toBe("control_request");
  expect(first.request_id).toBe("a1");
  expect(JSON.parse(b.lines[1] as string)).toEqual({ after: true });
  const done = await b.finish();
  expect(done.code).toBe(9);
  expect(done.stdout.filter((e) => e.type === "user")).toHaveLength(0);
  expect(done.stdout.filter((e) => e.type === "result")).toHaveLength(0);
});

test("03.4 an ask then an outside edit then exit 0: one reply, script exit code, failed edit, outside file unchanged", async () => {
  const outside = join(dir, "outside.txt");
  writeFileSync(outside, "known");
  install({
    roles: {
      builder: {
        exit: 0,
        replies: [[{ ask: { id: "a1", tool: "Edit" } }, { edit: "../outside.txt", content: "changed" }]],
      },
    },
  });
  const b = launch("builder");
  b.say("go");
  await b.waitFor(1);
  b.send(allow("a1"));
  const done = await b.finish();
  expect(readFileSync(outside, "utf8")).toBe("known");
  // The build ends with the script's exit code (0).
  expect(done.code).toBe(0);
  // The edit step is reported as failed.
  expect(done.stderr + JSON.stringify(done.stdout)).toMatch(/edit|outside|fail/i);
});

test("03.5 with no script the fake fails at once and plays no reply", async () => {
  const a = launch("builder", [], false);
  a.say("go");
  const done = await a.finish();
  expect(done.code).not.toBe(0);
  expect(done.stderr).toContain("no script");
  expect(done.stdout).toHaveLength(0);
  expect(existsSync(`${scriptPath}.launches.jsonl`)).toBe(false);
});
