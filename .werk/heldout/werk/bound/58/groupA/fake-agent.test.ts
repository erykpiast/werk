import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { LaunchRecord, MessageRecord } from "../../src/fake-agent/launch-log.ts";
import { readRecords } from "../../src/fake-agent/launch-log.ts";
import type { Script } from "../../src/fake-agent/script.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { CLI, decided, writeLog } from "./helpers.ts";

const BIN = join(import.meta.dir, "..", "..", "fake", "claude");

// ---- the fake agent launched on its own (03.2 to 03.5) ----
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
const install = (s: Script) => writeFileSync(scriptPath, JSON.stringify(s));

function launch(role: string | undefined, stdin: "pipe" | "ignore" = "pipe") {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", WERK_FAKE_SCRIPT: scriptPath };
  if (role) env.WERK_AGENT_ROLE = role;
  const child = Bun.spawn(["bun", BIN, "-p"], { cwd: project, env, stdin, stdout: "pipe", stderr: "pipe" });
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
  const sink = () => child.stdin as import("bun").FileSink;
  return {
    child,
    lines,
    send(l: string) {
      sink().write(l);
      sink().flush();
    },
    say(t: string) {
      this.send(`${JSON.stringify({ type: "user", message: { role: "user", content: t } })}\n`);
    },
    close: () => sink().end(),
    async waitFor(n: number) {
      while (lines.length < n) await new Promise<void>((w) => waiters.push(w));
    },
    async finish() {
      const code = await child.exited;
      await reading;
      return { code, stdout: lines.map((l) => JSON.parse(l)), stderr: await new Response(child.stderr).text() };
    },
  };
}
const answer = (id: string, behavior: string) =>
  `${JSON.stringify({ type: "control_response", response: { request_id: id, response: { behavior } } })}\n`;

test("03.2 a chat answers two messages and ends when its input closes", async () => {
  install({ roles: { chat: { replies: [[{ event: { type: "assistant", text: "R1" } }], [{ event: { type: "assistant", text: "R2" } }]] } } });
  const c = launch("chat");
  c.say("first");
  await c.waitFor(3); // init, reply, result
  expect(c.lines.some((l) => l.includes("R1"))).toBe(true);
  expect(c.child.exitCode).toBeNull(); // chat stays open
  c.say("second");
  await c.waitFor(5);
  expect(c.lines.some((l) => l.includes("R2"))).toBe(true);
  c.close();
  const done = await c.finish();
  expect(done.code).toBe(0);
});

test("03.3 a crash after an open ask prints no final result", async () => {
  install({ roles: { builder: { replies: [[{ ask: { id: "a1", tool: "Bash" } }, { pause: 50 }, { event: { type: "assistant", text: "after" } }, { crash: 9 }]] } } });
  const b = launch("builder");
  b.say("go");
  const done = await b.finish();
  expect(done.stdout[0].type).toBe("control_request");
  expect(done.stdout[1].text).toBe("after"); // steps after the ask play before any answer
  expect(done.stdout.some((e) => e.type === "user")).toBe(false);
  expect(done.stdout.some((e) => e.type === "result")).toBe(false);
  expect(done.code).toBe(9);
});

test("03.4 an ask build ends after one reply; a bad edit path changes nothing", async () => {
  const outside = join(dir, "outside.txt");
  writeFileSync(outside, "known");
  install({ roles: { builder: { exit: 0, replies: [[{ ask: { id: "a1", tool: "Bash" } }, { edit: "../outside.txt", content: "changed" }]] } } });
  const b = launch("builder");
  b.say("go");
  const first = await Promise.race([b.waitFor(1).then(() => "line"), b.child.exited.then(() => "exited")]);
  if (first === "line") b.send(answer("a1", "allow"));
  const done = await b.finish();
  console.log("03.4 first:", first, "code:", done.code, "stderr:", done.stderr.trim(), JSON.stringify(done.stdout));
  expect(first).toBe("line"); // the permission request is shown
  expect(done.code).toBe(0); // the script's exit code
  expect(done.stderr).toContain("../outside.txt"); // edit reported as failed
  expect(readFileSync(outside, "utf8")).toBe("known");
});

test("03.5 with no script the fake agent fails at once", async () => {
  const child = Bun.spawn(["bun", BIN, "-p"], { cwd: project, env: { PATH: process.env.PATH ?? "", WERK_AGENT_ROLE: "builder" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  expect(await child.exited).not.toBe(0);
  expect(await new Response(child.stdout).text()).toBe("");
  expect(await new Response(child.stderr).text()).toContain("no script");
});

// ---- 03.1 through a real build ----
test("03.1 roles get their own scripted replies in a build", async () => {
  const p: Project = createProject();
  try {
    writeFileSync(join(p.dir, "Makefile"), "check:\n\t@test -f note.txt\n");
    await p.run(["git", "add", "-A"]);
    await p.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
    writeLog(p, decided("top", { title: "Seat price", why: "Because." }));
    const board = join(p.dir, ".werk", "board.jsonl");
    writeFileSync(board, `${JSON.stringify({ type: "ticket.planned", id: "r/01", title: "T" })}\n`);
    const file = join(p.dir, ".werk", "tickets", "r", "01.md");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "title: T\ncites: top\nblocked_by:\nstories: 1\ntouches: checks\n\n## What to build\n\nMake note.txt.\n\n## Acceptance criteria\n\n- [ ] note\n\n## Checks\n\n- `make check`\n");
    p.install({
      roles: {
        builder: { replies: [[{ edit: "note.txt", content: "hello" }]] },
        grader: { replies: [[{ event: { type: "assistant", text: "GRADER-PASS" } }]] },
      },
    });
    const r = await p.run(["bun", CLI, "build", "r/01", "--poll-ms", "100"]);
    console.log("03.1 build:", r.stdout, r.stderr);
    const rec = p.launches();
    const launches = rec.filter((x): x is LaunchRecord => x.kind === "launch");
    console.log("03.1 launches:", JSON.stringify(launches.map((l) => [l.role, l.args.length])));
    const note = await p.run(["git", "show", "r/01:note.txt"]);
    expect(note.stdout).toBe("hello");
    expect(launches.filter((l) => l.role === "builder")).toHaveLength(1);
    expect(launches.filter((l) => l.role === "grader")).toHaveLength(1);
    expect(launches.every((l) => Array.isArray(l.args))).toBe(true);
    const msgs = rec.filter((x): x is MessageRecord => x.kind === "message");
    expect(msgs.some((m) => m.role === "grader")).toBe(true);
  } finally {
    await p.dispose();
  }
});

// ---- 03.1 prompt independence, fake on its own ----
test("03.1b scripted reply follows the role, not the prompt", async () => {
  install({ roles: { builder: { replies: [[{ event: { type: "assistant", text: "B" } }]] }, grader: { replies: [[{ event: { type: "assistant", text: "G" } }]] } } });
  const b = launch("builder");
  b.say("Build the ticket");
  expect((await b.finish()).stdout[0].text).toBe("B");
  const g = launch("grader");
  g.say("Build the ticket");
  expect((await g.finish()).stdout[0].text).toBe("G");
  const l = readRecords(`${scriptPath}.launches.jsonl`).filter((r) => r.kind === "launch");
  expect(l.map((x) => x.role)).toEqual(["builder", "grader"]);
});
