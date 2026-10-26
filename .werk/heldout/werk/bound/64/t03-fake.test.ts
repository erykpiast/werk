import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanEnv, FAKE_DIR } from "../src/test-env/env.ts";
import { createProject, type Project } from "./h.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

/** Starts the fake agent the way werk does: by the program name claude, with a role. */
function launch(role: string, args: string[] = []) {
  const child = Bun.spawn([join(FAKE_DIR, "claude"), ...args], {
    cwd: p.dir,
    env: {
      ...cleanEnv(process.env),
      WERK_FAKE_SCRIPT: join(p.dir, "..", "script.json"),
      WERK_AGENT_ROLE: role,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const lines: string[] = [];
  const waiters: (() => void)[] = [];
  const reading = (async () => {
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
  let done = false;
  void child.exited.then(() => {
    done = true;
    for (const w of waiters.splice(0)) w();
  });
  const stdin = child.stdin as import("bun").FileSink;
  return {
    child,
    lines,
    say(text: string) {
      stdin.write(
        `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`,
      );
      stdin.flush();
    },
    answer(id: string, behavior: "allow" | "deny") {
      stdin.write(
        `${JSON.stringify({ type: "control_response", response: { request_id: id, response: { behavior } } })}\n`,
      );
      stdin.flush();
    },
    close: () => stdin.end(),
    async waitFor(n: number) {
      while (lines.length < n && !done)
        await new Promise<void>((w) => waiters.push(w));
      return lines.length >= n;
    },
    async finish() {
      const code = await child.exited;
      await reading;
      return {
        code,
        out: lines.map((l) => JSON.parse(l)),
        err: await new Response(child.stderr).text(),
      };
    },
  };
}
const install = (s: unknown) => p.install(s as never);
const ev = (text: string) => ({ event: { type: "assistant", text } });

test("03.1 roles get their own scripted replies, whatever the prompt", async () => {
  install({
    roles: {
      builder: { replies: [[ev("B"), { edit: "note.txt", content: "hello" }]] },
      grader: { replies: [[ev("G")]] },
    },
  });
  const b = launch("builder", ["--print", "x"]);
  b.say("Build the ticket");
  const built = await b.finish();
  expect(built.out[0]).toEqual({ type: "assistant", text: "B" });
  expect(readFileSync(join(p.dir, "note.txt"), "utf8")).toBe("hello");
  const g = launch("grader", ["--print", "y"]);
  g.say("Grade it");
  const graded = await g.finish();
  expect(graded.out[0]).toEqual({ type: "assistant", text: "G" });
  const l = p.launches().filter((r) => r.kind === "launch");
  expect(l.map((r) => r.role)).toEqual(["builder", "grader"]);
  expect((l[0] as { args: string[] }).args).toEqual(["--print", "x"]);
});

test("03.2 a chat answers two messages and ends when input closes", async () => {
  install({ roles: { chat: { replies: [[ev("one")], [ev("two")]] } } });
  const c = launch("chat");
  c.say("first");
  await c.waitFor(3);
  expect(c.lines.join("\n")).toContain('"text":"one"');
  expect(c.child.exitCode).toBeNull();
  c.say("second");
  await c.waitFor(5);
  expect(c.lines.join("\n")).toContain('"text":"two"');
  c.close();
  const r = await c.finish();
  expect(r.code).toBe(0);
});

test("03.3 a crash after an open ask prints no final result", async () => {
  install({
    roles: {
      builder: {
        replies: [[{ ask: { id: "a1", tool: "Bash" } }, { pause: 50 }, { crash: 7 }]],
      },
    },
  });
  const b = launch("builder");
  b.say("go");
  const r = await b.finish();
  expect(r.out[0].type).toBe("control_request");
  expect(r.code).toBe(7);
  expect(r.out.some((o) => o.type === "result")).toBe(false);
  expect(JSON.stringify(r.out)).not.toContain("tool_result");
});

test("03.4 an ask, an outside edit, exit code", async () => {
  const outside = join(p.dir, "..", "outside.txt");
  writeFileSync(outside, "known");
  install({
    roles: {
      builder: {
        exit: 4,
        replies: [[{ ask: { id: "a1", tool: "Edit" } }, { edit: "../outside.txt", content: "changed" }]],
      },
    },
  });
  const b = launch("builder");
  b.say("go");
  const sawAsk = await b.waitFor(1);
  const askSeen = sawAsk && b.lines.join("").includes("control_request");
  if (askSeen) b.answer("a1", "allow");
  const r = await b.finish();
  expect(askSeen).toBe(true);
  expect(r.code).toBe(4);
  expect(r.err).toMatch(/outside/);
  expect(readFileSync(outside, "utf8")).toBe("known");
});

test("03.5 with no script the fake agent fails at once", async () => {
  const c = launch("builder");
  c.say("go");
  const r = await c.finish();
  expect(r.code).not.toBe(0);
  expect(r.out.length).toBe(0);
  expect(r.err.length).toBeGreaterThan(0);
  expect(existsSync(join(p.dir, "..", "script.json"))).toBe(false);
});
