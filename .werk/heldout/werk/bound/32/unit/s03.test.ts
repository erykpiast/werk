import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { logPathFor, readRecords } from "../../src/fake-agent/launch-log.ts";
import type { Script } from "../../src/fake-agent/script.ts";

const BIN = join(import.meta.dir, "..", "..", "fake", "claude");

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

const install = (script: Script) => writeFileSync(scriptPath, JSON.stringify(script));
const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});

/** Starts the fake agent as werk would start an agent of one role. */
function launch(role: string | null, args: string[] = [], withScript = true) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (withScript) env.WERK_FAKE_SCRIPT = scriptPath;
  if (role) env.WERK_AGENT_ROLE = role;
  const child = Bun.spawn(["bun", BIN, ...args], { cwd: project, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const lines: string[] = [];
  const waiters: (() => void)[] = [];
  const reading = (async () => {
    const decoder = new TextDecoder();
    let rest = "";
    for await (const chunk of child.stdout) {
      rest += decoder.decode(chunk, { stream: true });
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      lines.push(...parts);
      for (const w of waiters.splice(0)) w();
    }
  })();
  const stderr = new Response(child.stderr).text();
  const waitFor = async (pred: (l: string) => boolean, ms = 8000) => {
    const end = Date.now() + ms;
    for (;;) {
      const found = lines.find(pred);
      if (found !== undefined) return found;
      if (Date.now() > end) throw new Error(`timed out; lines so far:\n${lines.join("\n")}`);
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  };
  const send = (text: string) => {
    child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`);
    child.stdin.flush();
  };
  const answer = (id: string, allow: boolean) => {
    child.stdin.write(`${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: id, response: { behavior: allow ? "allow" : "deny", message: "no" } } })}\n`);
    child.stdin.flush();
  };
  const finish = async () => {
    const code = await child.exited;
    await reading;
    return { code, stdout: [...lines], stderr: await stderr };
  };
  return { child, lines, waitFor, send, answer, finish, closeInput: () => child.stdin.end() };
}

const types = (lines: string[]) => lines.map((l) => { try { return JSON.parse(l).type as string; } catch { return "?"; } });

test("03.1 roles get their own scripted replies, whatever the prompt says", async () => {
  install({
    roles: {
      builder: { replies: [[{ edit: "note.md", content: "built by the builder\n" }, say("b1", "builder reply")]] },
      grader: { replies: [[say("g1", "grader reply: pass")]] },
    },
  });
  const b = launch("builder", ["--print", "--model", "m1"]);
  b.send("Build the ticket");
  b.closeInput();
  const bo = await b.finish();
  expect(bo.code).toBe(0);
  expect(bo.stdout.join("\n")).toContain("builder reply");
  expect(readFileSync(join(project, "note.md"), "utf8")).toBe("built by the builder\n");
  const g = launch("grader", ["--print"]);
  g.send("Grade the pass");
  g.closeInput();
  const go = await g.finish();
  expect(go.stdout.join("\n")).toContain("grader reply: pass");
  expect(go.stdout.join("\n")).not.toContain("builder reply");
  const launches = readRecords(logPathFor(scriptPath)).filter((r) => r.kind === "launch");
  expect(launches.map((l) => l.role)).toEqual(["builder", "grader"]);
  expect(launches[0]).toMatchObject({ args: ["--print", "--model", "m1"] });
  expect(launches[1]).toMatchObject({ args: ["--print"] });
});

test("03.2 a chat answers two messages and ends when its input closes", async () => {
  install({ roles: { chat: { replies: [[say("m1", "first reply")], [say("m2", "second reply")]] } } });
  const c = launch("chat");
  c.send("one");
  await c.waitFor((l) => l.includes("first reply"));
  await c.waitFor((l) => l.includes('"type":"result"'));
  expect(c.child.exitCode).toBeNull();
  c.send("two");
  await c.waitFor((l) => l.includes("second reply"));
  c.closeInput();
  const out = await c.finish();
  expect(out.code).toBe(0);
});

test("03.3 a crash after an open ask prints no final result", async () => {
  install({
    roles: {
      builder: {
        replies: [[
          { ask: { id: "ask-1", tool: "Bash", input: { command: "ls" } } },
          { pause: 100 },
          say("after", "after the ask, before any answer"),
          { crash: 3 },
        ]],
      },
    },
  });
  const b = launch("builder");
  b.send("Implement the ticket");
  await b.waitFor((l) => l.includes('"can_use_tool"'));
  const out = await b.finish();
  expect(out.stdout.join("\n")).toContain("after the ask, before any answer");
  expect(out.code).toBe(3);
  expect(types(out.stdout)).not.toContain("result");
  expect(out.stdout.join("\n")).not.toContain("tool_result");
});

test("03.4 a build with an ask ends after one reply, and a bad edit path changes nothing", async () => {
  const outside = join(root, "outside.txt");
  writeFileSync(outside, "known content\n");
  install({
    roles: {
      builder: {
        replies: [[
          { ask: { id: "ask-1", tool: "Bash", input: { command: "ls" } } },
          { edit: "../outside.txt", content: "overwritten\n" },
        ]],
        exit: 0,
      },
    },
  });
  const b = launch("builder");
  b.send("Implement the ticket");
  await b.waitFor((l) => l.includes('"can_use_tool"'), 4000);
  b.answer("ask-1", true);
  const out = await b.finish();
  expect(out.code).toBe(0);
  expect(out.stderr + out.stdout.join("\n")).toMatch(/edit/i);
  expect(readFileSync(outside, "utf8")).toBe("known content\n");
});

test("03.5 with no script the fake agent fails at once", async () => {
  const a = launch("builder", [], false);
  const out = await a.finish();
  expect(out.code).not.toBe(0);
  expect(out.stderr).toMatch(/no script/);
  expect(out.stdout.join("\n")).toBe("");
});
