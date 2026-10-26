import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import { readRecords } from "../../src/fake-agent/launch-log.ts";
import type { Script } from "../../src/fake-agent/script.ts";
import { open } from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";

const BIN = join(import.meta.dir, "../../fake/claude");
const CLI = join(import.meta.dir, "../../src/cli.ts");

let dir: string;
let proj: string;
let scriptPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-heldout-fake-"));
  proj = join(dir, "project");
  mkdirSync(proj);
  scriptPath = join(dir, "script.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const install = (s: Script) => writeFileSync(scriptPath, JSON.stringify(s));

function launch(role: string, stdin: "pipe" | "ignore" = "pipe") {
  const child = Bun.spawn(["bun", BIN], {
    cwd: proj,
    env: { PATH: process.env.PATH ?? "", WERK_FAKE_SCRIPT: scriptPath, WERK_AGENT_ROLE: role },
    stdin,
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
  })();
  const sink = () => child.stdin as import("bun").FileSink;
  const send = (l: string) => {
    sink().write(l);
    sink().flush();
  };
  return {
    child,
    lines,
    say: (text: string) => send(`${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`),
    send,
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

// 03.1 -- through a real build
let project: Project;
const writeLines = (path: string, events: unknown[]) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const TICKET = `title: Write the note
cites: top
blocked_by:
stories: 1
touches: notes

## What to build

Write note.txt.

## Acceptance criteria

- [ ] note.txt exists

## Checks

- \`make check\`
`;

test("03.1 roles get their own scripted replies: builder and grader both launch once", async () => {
  project = createProject();
  try {
    project.install({
      roles: {
        builder: { replies: [[{ edit: "note.txt", content: "a note" }]] },
        grader: { replies: [[{ event: { type: "result", subtype: "success", is_error: false, result: "PASS" } }]] },
      },
    });
    writeFileSync(join(project.dir, "Makefile"), "check:\n\t@true\n");
    await project.run(["git", "add", "-A"]);
    await project.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
    writeLines(project.logPath, [
      ...open("top", { title: "Seat price", why: "Because." }),
      { type: "node.edited", id: "top", who: "me", noBasis: "test" },
      { type: "criterion.added", id: "top", form: "revisit" },
      { type: "node.decided", id: "top" },
    ]);
    const boardPath = join(project.dir, ".werk", "board.jsonl");
    writeLines(boardPath, [{ type: "ticket.planned", id: "r/01", title: "Write the note" }]);
    const file = join(project.dir, ".werk", "tickets", "r", "01.md");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, TICKET);

    const r = await project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100"]);
    expect(r.code).toBe(0);
    // The builder's scripted note appears in the project (on the build's branch).
    const shown = await project.run(["git", "show", "r/01:note.txt"]);
    expect(shown.stdout).toBe("a note");
    const launches = project.launches().filter((x) => x.kind === "launch");
    expect(launches.filter((x) => x.role === "builder")).toHaveLength(1);
    // The grader plays its own scripted reply: one launch, with role and arguments.
    const graders = launches.filter((x) => x.role === "grader");
    expect(graders).toHaveLength(1);
    expect(readBoard(boardPath).tickets.get("r/01")).toBeDefined();
  } finally {
    await project.dispose();
  }
}, 60000);

test("03.2 a chat answers two messages and exits when its input closes", async () => {
  install({ roles: { chat: { replies: [[{ event: { r: 1 } }], [{ event: { r: 2 } }]] } } });
  const chat = launch("chat");
  chat.say("M1");
  await chat.waitFor(3);
  expect(chat.lines.map((l) => JSON.parse(l)).some((e) => e.r === 1)).toBe(true);
  expect(chat.child.exitCode).toBeNull();
  chat.say("M2");
  await chat.waitFor(5);
  expect(chat.lines.map((l) => JSON.parse(l)).some((e) => e.r === 2)).toBe(true);
  chat.close();
  const done = await chat.finish();
  expect(done.code).toBe(0);
});

test("03.3 an ask, a pause and a crash: no tool result and no final result", async () => {
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
  expect(done.stdout[0].type).toBe("control_request");
  expect(done.stdout[0].request_id).toBe("a1");
  expect(done.stdout.some((e) => e.late === 1)).toBe(true);
  expect(done.stdout.some((e) => e.type === "user")).toBe(false);
  expect(done.stdout.some((e) => e.type === "result")).toBe(false);
  expect(done.code).toBe(9);
});

test("03.4 a build with an ask ends after one reply; a bad edit path changes nothing", async () => {
  const outside = join(dir, "x.txt");
  writeFileSync(outside, "before");
  install({
    roles: {
      builder: {
        exit: 0,
        replies: [[{ ask: { id: "a1", tool: "Bash" } }, { edit: "../x.txt", content: "after" }]],
      },
    },
  });
  const b = launch("builder");
  b.say("go");
  // The answer goes in at once; a reply that plays an ask would read it.
  b.send(`${JSON.stringify({ type: "control_response", response: { request_id: "a1", response: { behavior: "allow" } } })}\n`);
  const done = await b.finish();
  expect(done.stderr).toContain("../x.txt");
  expect(done.stdout.some((e) => e.type === "control_request")).toBe(true);
  expect(done.code).toBe(0);
  expect(readFileSync(outside, "utf8")).toBe("before");
});

test("03.4b the same build ends with the script's exit code when the edit path is good", async () => {
  install({ roles: { builder: { exit: 0, replies: [[{ ask: { id: "a1", tool: "Bash" } }]] } } });
  const b = launch("builder");
  b.say("go");
  await b.waitFor(1);
  b.send(`${JSON.stringify({ type: "control_response", response: { request_id: "a1", response: { behavior: "allow" } } })}\n`);
  const done = await b.finish();
  expect(done.code).toBe(0);
});

test("03.5 with no script the fake exits with an error at once and plays no reply", async () => {
  const child = Bun.spawn(["bun", BIN], {
    cwd: proj,
    env: { PATH: process.env.PATH ?? "", WERK_AGENT_ROLE: "builder" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await child.exited).not.toBe(0);
  expect(await new Response(child.stdout).text()).toBe("");
  expect(await new Response(child.stderr).text()).toContain("no script installed");
  expect(existsSync(`${scriptPath}.launches.jsonl`)).toBe(false);
  expect(readRecords(`${scriptPath}.launches.jsonl`)).toEqual([]);
});
