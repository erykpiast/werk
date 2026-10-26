import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRecords } from "../../src/fake-agent/launch-log.ts";
import type { Script } from "../../src/fake-agent/script.ts";

const BIN = join(import.meta.dir, "../../fake/claude");
let dir: string;
let project: string;
let scriptPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "heldout-fake-"));
  project = join(dir, "project");
  mkdirSync(project);
  scriptPath = join(dir, "script.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const install = (s: Script) => writeFileSync(scriptPath, JSON.stringify(s));

function launch(role: string | undefined, args: string[] = []) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", WERK_FAKE_SCRIPT: scriptPath };
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
  })();
  const sink = child.stdin as import("bun").FileSink;
  const send = (l: string) => {
    sink.write(l);
    sink.flush();
  };
  return {
    child,
    lines,
    say: (t: string) => send(`${JSON.stringify({ type: "user", message: { role: "user", content: t } })}\n`),
    send,
    close: () => sink.end(),
    async waitFor(n: number) {
      while (lines.length < n) await new Promise<void>((w) => waiters.push(w));
    },
    async finish() {
      const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
      await Bun.sleep(20);
      return { code, stderr, stdout: lines.map((l) => JSON.parse(l)) };
    },
  };
}
const records = () => readRecords(`${scriptPath}.launches.jsonl`);

test("03.2 a chat answers two messages and ends when its input closes", async () => {
  install({ roles: { chat: { replies: [[{ event: { r: 1 } }], [{ event: { r: 2 } }]] } } });
  const chat = launch("chat");
  chat.say("M1");
  await chat.waitFor(3);
  expect(chat.lines.some((l) => JSON.parse(l).r === 1)).toBe(true);
  expect(chat.child.exitCode).toBeNull(); // chat stays open
  chat.say("M2");
  await chat.waitFor(5);
  expect(chat.lines.some((l) => JSON.parse(l).r === 2)).toBe(true);
  chat.close();
  const done = await chat.finish();
  expect(done.code).toBe(0);
});

test("03.3 a crash after an open ask prints no final result", async () => {
  install({
    roles: {
      builder: {
        replies: [[{ ask: { id: "a1", tool: "Bash" } }, { pause: 50 }, { event: { late: 1 } }, { crash: 9 }]],
      },
    },
  });
  const b = launch("builder");
  b.say("go");
  const done = await b.finish();
  // permission request first, then the later step, with no answer in between
  expect(done.stdout[0].type).toBe("control_request");
  expect(done.stdout[0].request_id).toBe("a1");
  expect(done.stdout[1]).toEqual({ late: 1 });
  expect(done.stdout.some((e) => e.type === "user")).toBe(false); // no tool result
  expect(done.stdout.some((e) => e.type === "result")).toBe(false); // no final result
  expect(done.code).toBe(9);
});

test("03.4 a build with an ask ends after one reply; a bad edit path changes nothing", async () => {
  const outside = join(dir, "outside.txt");
  writeFileSync(outside, "known content");
  install({
    roles: {
      builder: {
        exit: 0,
        replies: [[{ ask: { id: "a1", tool: "Bash" } }, { edit: "../outside.txt", content: "changed" }]],
      },
    },
  });
  const b = launch("builder");
  b.say("go");
  // wait for either the permission request or the end of the process
  const raced = await Promise.race([b.waitFor(1).then(() => "line"), b.child.exited.then(() => "exit")]);
  if (raced === "line") {
    b.send(
      `${JSON.stringify({ type: "control_response", response: { request_id: "a1", subtype: "success", response: { behavior: "allow" } } })}\n`,
    );
  }
  const done = await b.finish();
  // the build ends after that one reply with the script's exit code (0)
  expect(done.code).toBe(0);
  // the edit step is reported as failed
  expect(done.stderr).toMatch(/edit/i);
  expect(readFileSync(outside, "utf8")).toBe("known content");
});

test("03.5 with no script the fake agent fails at once", async () => {
  const child = Bun.spawn(["bun", BIN], {
    cwd: project,
    env: { PATH: process.env.PATH ?? "", WERK_AGENT_ROLE: "builder" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await child.exited;
  expect(code).not.toBe(0);
  expect(await new Response(child.stdout).text()).toBe("");
  expect(await new Response(child.stderr).text()).toMatch(/no script/);
});

// ---------- 03.1: through the real build ----------
import { createProject, type Project } from "../../src/test-env/project.ts";
import type { LaunchRecord } from "../../src/fake-agent/launch-log.ts";
import { open } from "../../src/map/mark-fixtures.ts";
import { writeLines } from "../cli/helpers.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const TICKET = `title: Make the check pass
cites: top
blocked_by:
stories: 1
touches: checks

## What to build

Make ok.txt exist.

## Acceptance criteria

- [ ] ok.txt exists

## Checks

- \`make check\`
`;
const result = (text: string) => [{ event: { type: "result", subtype: "success", is_error: false, result: text } }];
const AREA = ["reviewer-design", "reviewer-maintainability", "reviewer-tests", "reviewer-security", "reviewer-performance"];

test("03.1 roles get their own scripted replies, whatever the prompt says", async () => {
  const p: Project = createProject();
  try {
    writeFileSync(join(p.dir, "Makefile"), "check:\n\t@test -f ok.txt\n");
    await p.run(["git", "add", "-A"]);
    await p.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
    writeLines(p.logPath, [
      ...open("top", { title: "Seat price", why: "Because." }),
      { type: "node.edited", id: "top", who: "me", noBasis: "test" },
      { type: "criterion.added", id: "top", form: "revisit" },
      { type: "node.decided", id: "top" },
    ]);
    writeLines(join(p.dir, ".werk", "board.jsonl"), [{ type: "ticket.planned", id: "r/01", title: "Make the check pass" }]);
    const tf = join(p.dir, ".werk", "tickets", "r", "01.md");
    mkdirSync(join(p.dir, ".werk", "tickets", "r"), { recursive: true });
    writeFileSync(tf, TICKET);
    const grade = result(JSON.stringify({ lines: [{ line: "criterion-1", score: 4, gap: "" }, { line: "card-top", score: 4, gap: "" }, { line: "scope", score: 5, gap: "" }] }));
    p.install({
      roles: {
        builder: { replies: [[{ edit: "note.txt", content: "a note" }, { edit: "ok.txt", content: "done" }]] },
        grader: { replies: [grade] },
        ...Object.fromEntries(AREA.map((r) => [r, { replies: [result(JSON.stringify({ findings: [] }))] }])),
      },
    });
    const r = await p.run(["bun", CLI, "build", "r/01", "--poll-ms", "100"]);
    expect(r.code).toBe(0);
    // the note is in the project: committed on the build's branch
    const shown = await p.run(["git", "show", "r/01:note.txt"]);
    expect(shown.stdout).toBe("a note");
    const launches = p.launches().filter((x): x is LaunchRecord => x.kind === "launch");
    const builders = launches.filter((l) => l.role === "builder");
    const graders = launches.filter((l) => l.role === "grader");
    expect(builders).toHaveLength(1);
    expect(graders).toHaveLength(1);
    expect(Array.isArray(builders[0]?.args)).toBe(true);
    expect(Array.isArray(graders[0]?.args)).toBe(true);
    // the grader played its own reply, not the builder's: the grade was read (build went on to merging)
    expect(r.stdout).toContain("merging");
    // the builder prompt of the product is what it is; the reply does not depend on it
    const msgs = p.launches().filter((x) => x.kind === "message" && x.role === "builder");
    expect(msgs).toHaveLength(1);
  } finally {
    await p.dispose();
  }
});
