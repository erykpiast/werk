import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRecords } from "../src/fake-agent/launch-log.ts";
import type { Script } from "../src/fake-agent/script.ts";

const BIN = join(import.meta.dir, "..", "fake", "claude");
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
const msg = (text: string) => `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;

function launch(role: string | undefined, args: string[] = [], withScript = true) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (withScript) env.WERK_FAKE_SCRIPT = scriptPath;
  if (role) env.WERK_AGENT_ROLE = role;
  const child = Bun.spawn(["bun", BIN, ...args], { cwd: project, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const lines: string[] = [];
  const waiters: (() => void)[] = [];
  (async () => {
    const dec = new TextDecoder();
    let rest = "";
    for await (const chunk of child.stdout) {
      rest += dec.decode(chunk, { stream: true });
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      lines.push(...parts);
      for (const w of waiters.splice(0)) w();
    }
  })();
  const stdin = child.stdin as import("bun").FileSink;
  return {
    child,
    lines,
    send(text: string) {
      stdin.write(text);
      stdin.flush();
    },
    close() {
      stdin.end();
    },
    async waitFor(pred: (lines: string[]) => boolean, ms = 8000) {
      const end = Date.now() + ms;
      while (!pred(lines)) {
        if (Date.now() > end) throw new Error(`timeout; lines: ${lines.join("\n")}`);
        await new Promise<void>((w) => {
          waiters.push(w);
          setTimeout(w, 100);
        });
      }
    },
    async stderr() {
      return await new Response(child.stderr).text();
    },
  };
}
const result = (text: string) => ({ type: "result", subtype: "success", is_error: false, result: text });
const has = (lines: string[], needle: string) => lines.some((l) => l.includes(needle));

test("03.1 roles get their own scripted replies, whatever the prompt says", async () => {
  install({
    roles: {
      builder: { replies: [[{ edit: "note.txt", content: "built" }, { event: result("BUILDER-REPLY") }]] },
      grader: { replies: [[{ event: result("GRADER-PASS") }]] },
    },
  });
  const b = launch("builder", ["-p", "--model", "x"]);
  b.send(msg("Build the ticket"));
  b.close();
  expect(await b.child.exited).toBe(0);
  expect(readFileSync(join(project, "note.txt"), "utf8")).toBe("built");
  expect(b.lines.join("\n")).toContain("BUILDER-REPLY");
  const g = launch("grader", ["-p"]);
  g.send(msg("Grade the pass"));
  g.close();
  expect(await g.child.exited).toBe(0);
  expect(g.lines.join("\n")).toContain("GRADER-PASS");
  expect(g.lines.join("\n")).not.toContain("BUILDER-REPLY");
  const launches = readRecords(`${scriptPath}.launches.jsonl`).filter((r) => r.kind === "launch");
  expect(launches).toHaveLength(2);
  expect(launches.map((l) => (l.kind === "launch" ? l.role : ""))).toEqual(["builder", "grader"]);
  expect(launches[0]).toMatchObject({ args: ["-p", "--model", "x"] });
});

test("03.2 a chat answers two messages and ends when its input closes", async () => {
  install({ roles: { chat: { replies: [[{ event: result("first reply") }], [{ event: result("second reply") }]] } } });
  const c = launch("chat");
  c.send(msg("one"));
  await c.waitFor((l) => has(l, "first reply"));
  expect(c.child.exitCode).toBeNull();
  c.send(msg("two"));
  await c.waitFor((l) => has(l, "second reply"));
  c.close();
  expect(await c.child.exited).toBe(0);
});

test("03.3 a crash after an open ask prints no final result", async () => {
  install({
    roles: {
      build: {
        replies: [
          [
            { ask: { id: "a1", tool: "Bash", input: { command: "ls" } } },
            { pause: 50 },
            { event: { type: "assistant", message: { content: [{ type: "text", text: "AFTER-ASK" }] } } },
            { crash: 3 },
          ],
        ],
      },
    },
  });
  const a = launch("build");
  a.send(msg("go"));
  expect(await a.child.exited).toBe(3);
  const out = a.lines.join("\n");
  expect(out).toContain("control_request");
  expect(out).toContain("AFTER-ASK");
  expect(out.indexOf("control_request")).toBeLessThan(out.indexOf("AFTER-ASK"));
  expect(out).not.toContain("tool_result");
  expect(out).not.toContain('"type":"result"');
});

test("03.4 a build with an ask ends after one reply, and a bad edit path changes nothing", async () => {
  const outside = join(dir, "outside.txt");
  writeFileSync(outside, "known");
  install({
    roles: {
      build: {
        replies: [[{ ask: { id: "a1", tool: "Edit" } }, { edit: "../outside.txt", content: "changed" }]],
        exit: 0,
      },
    },
  });
  const a = launch("build");
  a.send(msg("go"));
  // The person answers the permission request if it is shown.
  try {
    await a.waitFor((l) => has(l, "control_request"), 1500);
    a.send(`${JSON.stringify({ type: "control_response", response: { request_id: "a1", response: { behavior: "allow" } } })}\n`);
  } catch {
    // no request was shown
  }
  const code = await a.child.exited;
  const err = await a.stderr();
  expect(readFileSync(outside, "utf8")).toBe("known");
  expect(existsSync(outside)).toBe(true);
  expect(err).toMatch(/edit path/);
  // the step says the build ends with the script's exit code (0) after one reply
  expect(code).toBe(0);
});

test("03.5 with no script the fake agent fails at once", async () => {
  const a = launch("build", [], false);
  a.close();
  const code = await a.child.exited;
  expect(code).not.toBe(0);
  expect(a.lines.join("")).toBe("");
  expect(await a.stderr()).toMatch(/no script/);
});
