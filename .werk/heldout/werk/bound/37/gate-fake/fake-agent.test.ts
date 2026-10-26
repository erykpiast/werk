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
import { join } from "node:path";
import type { LaunchRecord } from "../../src/fake-agent/launch-log.ts";
import { readRecords } from "../../src/fake-agent/launch-log.ts";
import type { Script } from "../../src/fake-agent/script.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";

const BIN = join(import.meta.dir, "../../fake/claude");
const CLI = join(import.meta.dir, "../../src/cli.ts");

let dir: string;
let work: string;
let scriptPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-held-fake-"));
  work = join(dir, "project");
  mkdirSync(work);
  scriptPath = join(dir, "script.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const install = (s: Script) => writeFileSync(scriptPath, JSON.stringify(s));

function launch(role: string | undefined, withScript = true) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (withScript) env.WERK_FAKE_SCRIPT = scriptPath;
  if (role) env.WERK_AGENT_ROLE = role;
  const child = Bun.spawn(["bun", BIN], {
    cwd: work,
    env,
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
  let exited = false;
  child.exited.then(() => {
    exited = true;
    for (const w of waiters.splice(0)) w();
  });
  const sink = child.stdin as import("bun").FileSink;
  return {
    child,
    lines,
    isExited: () => exited,
    send(line: string) {
      sink.write(line);
      sink.flush();
    },
    say(text: string) {
      this.send(
        `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`,
      );
    },
    close: () => sink.end(),
    // Waits until `count` lines exist or the process has exited.
    async waitFor(count: number) {
      while (lines.length < count && !exited)
        await new Promise<void>((w) => waiters.push(w));
    },
    async finish() {
      const code = await child.exited;
      await reading;
      return {
        code,
        stdout: lines.map((l) => JSON.parse(l)),
        stderr: await new Response(child.stderr).text(),
      };
    },
  };
}

test("03.2 a chat answers two messages and ends when its input closes", async () => {
  install({
    roles: {
      chat: {
        replies: [
          [{ event: { type: "assistant", text: "first reply" } }],
          [{ event: { type: "assistant", text: "second reply" } }],
        ],
      },
    },
  });
  const chat = launch("chat");
  chat.say("one");
  const has = (text: string) =>
    chat.lines.some((l) => l.includes(`"${text}"`));
  while (!has("first reply") && !chat.isExited())
    await chat.waitFor(chat.lines.length + 1);
  expect(has("first reply")).toBe(true);
  expect(has("second reply")).toBe(false);
  expect(chat.isExited()).toBe(false);
  chat.say("two");
  while (!has("second reply") && !chat.isExited())
    await chat.waitFor(chat.lines.length + 1);
  expect(has("second reply")).toBe(true);
  expect(chat.isExited()).toBe(false);
  chat.close();
  const done = await chat.finish();
  expect(done.code).toBe(0);
});

test("03.3 a crash after an open ask prints no final result", async () => {
  install({
    roles: {
      builder: {
        replies: [
          [
            { ask: { id: "a1", tool: "Bash", input: { command: "ls" } } },
            { event: { type: "assistant", text: "after the ask" } },
            { pause: 30 },
            { crash: 7 },
          ],
        ],
      },
    },
  });
  const b = launch("builder");
  b.say("go");
  const done = await b.finish();
  const types = done.stdout.map((e) => e.type);
  expect(types).toContain("control_request");
  const ask = done.stdout.findIndex((e) => e.type === "control_request");
  const after = done.stdout.findIndex((e) => e.text === "after the ask");
  expect(after).toBeGreaterThan(ask);
  expect(types).not.toContain("result");
  expect(done.stdout.some((e) => e.type === "user")).toBe(false);
  expect(done.code).toBe(7);
});

test("03.4 a build with an ask ends after one reply, and a bad edit path changes nothing", async () => {
  const outside = join(dir, "outside.txt");
  writeFileSync(outside, "known");
  install({
    roles: {
      builder: {
        exit: 0,
        replies: [
          [
            { ask: { id: "p1", tool: "Bash", input: { command: "ls" } } },
            { edit: "../outside.txt", content: "changed" },
          ],
        ],
      },
    },
  });
  const b = launch("builder");
  b.say("go");
  await b.waitFor(1);
  // The step says the permission request appears; answer it if it does.
  const sawAsk = b.lines.some((l) => l.includes("control_request"));
  if (sawAsk) {
    b.send(
      `${JSON.stringify({ type: "control_response", response: { request_id: "p1", response: { behavior: "allow" } } })}\n`,
    );
  }
  const done = await b.finish();
  expect(sawAsk).toBe(true);
  expect(done.code).toBe(0);
  expect(readFileSync(outside, "utf8")).toBe("known");
  // The edit step is reported as failed.
  expect(done.stderr + JSON.stringify(done.stdout)).toMatch(
    /edit path \.\.\/outside\.txt leads outside/,
  );
  // One reply: one launch record, one message.
  expect(
    readRecords(`${scriptPath}.launches.jsonl`).filter(
      (r) => r.kind === "message",
    ),
  ).toHaveLength(1);
});

test("03.5 with no script the fake agent fails at once", async () => {
  const a = launch("builder", false);
  a.say("hello");
  const done = await a.finish();
  expect(done.code).not.toBe(0);
  expect(done.stderr).toContain("no script");
  expect(done.stdout).toEqual([]);
});

// 03.1 needs a project with a build, so it uses the project harness.
let project: Project;
test("03.1 roles get their own scripted replies, whatever the prompt says", async () => {
  project = createProject();
  try {
    project.install({
      roles: {
        builder: {
          replies: [[{ edit: "note.txt", content: "a note" }]],
        },
        grader: {
          replies: [[{ event: { type: "assistant", text: "GRADER PASS" } }]],
        },
      },
    });
    writeFileSync(join(project.dir, "Makefile"), "check:\n\t@true\n");
    await project.run(["git", "add", "-A"]);
    await project.run(["git", "commit", "-q", "-m", "Makefile"]);
    const lines = (evs: unknown[]) =>
      evs.map((e) => `${JSON.stringify(e)}\n`).join("");
    const { open } = await import("../../src/map/mark-fixtures.ts");
    writeFileSync(
      project.logPath,
      lines([
        ...open("top", { title: "Seat price", why: "Because." }),
        { type: "node.edited", id: "top", who: "me", noBasis: "test" },
        { type: "criterion.added", id: "top", form: "revisit" },
        { type: "node.decided", id: "top" },
      ]),
    );
    writeFileSync(
      join(project.dir, ".werk", "board.jsonl"),
      lines([{ type: "ticket.planned", id: "r/01", title: "T" }]),
    );
    mkdirSync(join(project.dir, ".werk", "tickets", "r"), { recursive: true });
    writeFileSync(
      join(project.dir, ".werk", "tickets", "r", "01.md"),
      `title: T
cites: top
blocked_by:
stories: 1
touches: checks

## What to build

Write a note.

## Acceptance criteria

- [ ] note

## Checks

- \`make check\`
`,
    );
    await project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100"]);
    const note = await project.run(["git", "show", "r/01:note.txt"]);
    expect(note.stdout).toBe("a note");
    const launches = project
      .launches()
      .filter((r): r is LaunchRecord => r.kind === "launch");
    expect(launches.map((l) => l.role)).toEqual(["builder", "grader"]);
    for (const l of launches) expect(Array.isArray(l.args)).toBe(true);
  } finally {
    await project.dispose();
  }
});
