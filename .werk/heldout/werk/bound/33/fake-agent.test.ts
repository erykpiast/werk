import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readRecords } from "../src/fake-agent/launch-log.ts";

const BIN = resolve(import.meta.dir, "../fake/claude");
let dir: string;
let project: string;
let scriptPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-ho-fake-"));
  project = join(dir, "project");
  mkdirSync(project);
  scriptPath = join(dir, "script.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const install = (roles: unknown) =>
  writeFileSync(scriptPath, JSON.stringify({ roles }));
const msg = (text: string) =>
  `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;
const answer = (id: string, allow = true) =>
  `${JSON.stringify({ type: "control_response", response: { request_id: id, response: { behavior: allow ? "allow" : "deny" } } })}\n`;

function launch(role: string, args: string[] = [], withScript = true) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (withScript) env.WERK_FAKE_SCRIPT = scriptPath;
  env.WERK_AGENT_ROLE = role;
  const child = Bun.spawn(["bun", BIN, ...args], {
    cwd: project,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const lines: string[] = [];
  let rest = "";
  const waiters: (() => void)[] = [];
  void (async () => {
    const dec = new TextDecoder();
    for await (const chunk of child.stdout) {
      rest += dec.decode(chunk, { stream: true });
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      lines.push(...parts);
      for (const w of waiters.splice(0)) w();
    }
    for (const w of waiters.splice(0)) w();
  })();
  const stdin = child.stdin as import("bun").FileSink;
  return {
    child,
    lines,
    send(s: string) {
      stdin.write(s);
      stdin.flush();
    },
    close: () => stdin.end(),
    async waitFor(n: number, ms = 5000) {
      const end = Date.now() + ms;
      while (lines.length < n && Date.now() < end && child.exitCode === null)
        await new Promise<void>((w) => {
          waiters.push(w);
          setTimeout(w, 50);
        });
    },
    async stderr() {
      return await new Response(child.stderr).text();
    },
  };
}
const ev = (text: string) => ({
  event: { type: "assistant", message: { content: [{ type: "text", text }] } },
});
const result = (r: string) => ({
  event: { type: "result", subtype: "success", is_error: false, result: r },
});
const texts = (lines: string[]) => lines.join("\n");

test("03.1 roles get their own scripted replies whatever the prompt says", async () => {
  install({
    builder: {
      replies: [[{ edit: "note.md", content: "built" }, ev("builder reply"), result("B")]],
    },
    grader: { replies: [[ev("grader reply"), result("pass")]] },
  });
  const b = launch("builder", ["-p", "--model", "x"]);
  b.send(msg("Build the ticket"));
  b.close();
  await b.child.exited;
  const g = launch("grader", ["-p", "--flag"]);
  g.send(msg("Grade it"));
  g.close();
  await g.child.exited;
  expect(readFileSync(join(project, "note.md"), "utf8")).toBe("built");
  expect(texts(b.lines)).toContain("builder reply");
  expect(texts(g.lines)).toContain("grader reply");
  expect(texts(g.lines)).not.toContain("builder reply");
  const launches = readRecords(`${scriptPath}.launches.jsonl`).filter((r) => r.kind === "launch");
  expect(launches.map((l) => l.role)).toEqual(["builder", "grader"]);
  expect((launches[0] as { args: string[] }).args).toEqual(["-p", "--model", "x"]);
  expect((launches[1] as { args: string[] }).args).toEqual(["-p", "--flag"]);
});

test("03.2 a chat answers two messages and ends when input closes", async () => {
  install({ chat: { replies: [[ev("first reply")], [ev("second reply")]] } });
  const c = launch("chat");
  c.send(msg("one"));
  await c.waitFor(3); // init, reply, result
  expect(texts(c.lines)).toContain("first reply");
  expect(c.child.exitCode).toBeNull();
  c.send(msg("two"));
  await c.waitFor(5);
  expect(texts(c.lines)).toContain("second reply");
  expect(c.child.exitCode).toBeNull();
  c.close();
  expect(await c.child.exited).toBe(0);
});

test("03.3 a crash after an open ask prints no tool result and no final result", async () => {
  install({
    build: {
      replies: [
        [
          { ask: { id: "a1", tool: "Bash", input: { command: "ls" } } },
          ev("after ask"),
          { pause: 100 },
          ev("after pause"),
          { crash: 3 },
        ],
      ],
    },
  });
  const b = launch("build");
  b.send(msg("go"));
  const code = await b.child.exited;
  const out = texts(b.lines);
  expect(out).toContain("control_request");
  expect(out).toContain("after ask");
  expect(out).toContain("after pause");
  expect(out).not.toContain("tool_result");
  expect(out).not.toContain('"type":"result"');
  expect(code).toBe(3);
  expect(out.indexOf("control_request")).toBeLessThan(out.indexOf("after ask"));
});

test("03.4 a build with an ask ends after one reply; a bad edit path changes nothing", async () => {
  const outside = join(dir, "outside.txt");
  writeFileSync(outside, "known");
  install({
    build: {
      replies: [
        [
          { ask: { id: "a1", tool: "Edit" } },
          { edit: "../outside.txt", content: "CHANGED" },
        ],
      ],
      exit: 7,
    },
  });
  const b = launch("build");
  b.send(msg("go"));
  await b.waitFor(1, 1500);
  const sawRequest = texts(b.lines).includes("control_request");
  if (sawRequest) b.send(answer("a1"));
  const code = await b.child.exited;
  const err = await b.stderr();
  expect(readFileSync(outside, "utf8")).toBe("known");
  const detail = `sawRequest=${sawRequest} code=${code} stderr=${err.trim()} out=${texts(b.lines)}`;
  console.log(detail);
  expect(sawRequest, detail).toBe(true);
  expect(code, detail).toBe(7);
  expect(err, detail).toContain("outside");
});

test("03.5 with no script the fake agent fails at once", async () => {
  const a = launch("builder", [], false);
  a.close();
  const code = await a.child.exited;
  expect(code).not.toBe(0);
  expect(a.lines.length).toBe(0);
  expect(await a.stderr()).toContain("no script");
  expect(existsSync(`${scriptPath}.launches.jsonl`)).toBe(false);
});
