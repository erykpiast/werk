import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRecords } from "../src/fake-agent/launch-log.ts";

const BIN = join(import.meta.dir, "..", "fake", "claude");
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
const install = (s: unknown) => writeFileSync(scriptPath, JSON.stringify(s));

function launch(role: string | undefined, args: string[] = [], withScript = true) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (withScript) env.WERK_FAKE_SCRIPT = scriptPath;
  if (role) env.WERK_AGENT_ROLE = role;
  const child = Bun.spawn(["bun", BIN, ...args], { cwd: project, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
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
  })();
  const sink = child.stdin as import("bun").FileSink;
  const msg = (t: string) => `${JSON.stringify({ type: "user", message: { role: "user", content: t } })}\n`;
  return {
    lines,
    say(t: string) { sink.write(msg(t)); sink.flush(); },
    send(l: string) { sink.write(l); sink.flush(); },
    close() { sink.end(); },
    async waitFor(n: number) { while (lines.length < n) await new Promise<void>((w) => waiters.push(w)); },
    async finish() {
      const code = await child.exited;
      await reading;
      return { code, out: lines.map((l) => JSON.parse(l)), err: await new Response(child.stderr).text() };
    },
  };
}
const asst = (t: string) => ({ event: { type: "assistant", text: t } });
const answer = (id: string, behavior: "allow" | "deny") =>
  `${JSON.stringify({ type: "control_response", response: { request_id: id, response: { behavior } } })}\n`;

test("03.1 roles play own replies whatever the prompt says", async () => {
  install({ roles: {
    builder: { exit: 0, replies: [[asst("B"), { edit: "note.txt", content: "a note" }]] },
    grader: { exit: 0, replies: [[asst("G")]] },
  } });
  const b = launch("builder", ["--model", "x"]);
  b.say("Build the ticket");
  const built = await b.finish();
  expect(built.out[0]).toEqual({ type: "assistant", text: "B" });
  expect(readFileSync(join(project, "note.txt"), "utf8")).toBe("a note");
  const g = launch("grader", ["--print"]);
  g.say("Build the ticket");
  const graded = await g.finish();
  expect(graded.out[0]).toEqual({ type: "assistant", text: "G" });
  const launches = readRecords(`${scriptPath}.launches.jsonl`).filter((r) => r.kind === "launch");
  expect(launches.map((l) => l.role)).toEqual(["builder", "grader"]);
  expect((launches[0] as { args: string[] }).args).toEqual(["--model", "x"]);
  expect((launches[1] as { args: string[] }).args).toEqual(["--print"]);
});

test("03.2 chat answers two messages and ends when input closes", async () => {
  install({ roles: { chat: { replies: [[asst("one")], [asst("two")]] } } });
  const c = launch("chat");
  c.say("first");
  await c.waitFor(3); // init, assistant, result
  expect(c.lines.join("\n")).toContain('"text":"one"');
  c.say("second");
  await c.waitFor(5);
  expect(c.lines.join("\n")).toContain('"text":"two"');
  c.close();
  const done = await c.finish();
  expect(done.code).toBe(0);
});

test("03.3 crash after open ask prints no final result", async () => {
  install({ roles: { builder: { replies: [[
    { ask: { id: "a1", tool: "Bash", input: { command: "ls" } } },
    asst("after"),
    { pause: 100 },
    { crash: 3 },
  ]] } } });
  const b = launch("builder");
  b.say("go");
  const done = await b.finish();
  const types = done.out.map((o) => o.type);
  expect(types).toContain("control_request");
  const iReq = types.indexOf("control_request");
  expect(types.indexOf("assistant")).toBeGreaterThan(iReq);
  expect(types).not.toContain("result");
  expect(JSON.stringify(done.out)).not.toContain("tool_result");
  expect(done.code).toBe(3);
});

test("03.4 ask then an edit outside the project: one reply, edit fails, outside file kept", async () => {
  const outside = join(dir, "outside.txt");
  writeFileSync(outside, "known");
  install({ roles: { builder: { exit: 0, replies: [[
    { ask: { id: "a1", tool: "Edit" } },
    { edit: "../outside.txt", content: "changed" },
  ]] } } });
  const b = launch("builder");
  b.say("go");
  await Promise.race([b.waitFor(1), Bun.sleep(5000)]);
  const sawRequest = b.lines.some((l) => l.includes("control_request"));
  if (sawRequest) b.send(answer("a1", "allow"));
  const done = await b.finish();
  expect(sawRequest).toBe(true);
  expect(done.code).toBe(0);
  expect(readFileSync(outside, "utf8")).toBe("known");
  expect(done.err + JSON.stringify(done.out)).toMatch(/outside|failed|leads/);
});

test("03.5 no script: exits with an error at once and plays no reply", async () => {
  const b = launch("builder", [], false);
  const t0 = Date.now();
  const done = await b.finish();
  expect(done.code).not.toBe(0);
  expect(done.out.length).toBe(0);
  expect(done.err).toContain("no script");
  expect(Date.now() - t0).toBeLessThan(5000);
  expect(existsSync(`${scriptPath}.launches.jsonl`)).toBe(false);
});
