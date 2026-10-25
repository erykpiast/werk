import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRecords } from "./launch-log.ts";
import type { Script } from "./script.ts";

const BIN = join(import.meta.dir, "../../fake/claude");

let dir: string;
let project: string;
let scriptPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-fake-"));
  project = join(dir, "project");
  mkdirSync(project);
  scriptPath = join(dir, "script.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const install = (script: Script) =>
  writeFileSync(scriptPath, JSON.stringify(script));

function launch(
  role: string | undefined,
  args: string[] = [],
  stdin: "pipe" | "ignore" = "pipe",
) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    WERK_FAKE_SCRIPT: scriptPath,
  };
  if (role) env.WERK_AGENT_ROLE = role;
  const child = Bun.spawn(["bun", BIN, ...args], {
    cwd: project,
    env,
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
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
  const message = (text: string) =>
    `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;
  return {
    child,
    lines,
    send(line: string) {
      (child.stdin as import("bun").FileSink).write(line);
      (child.stdin as import("bun").FileSink).flush();
    },
    say(text: string) {
      this.send(message(text));
    },
    close() {
      (child.stdin as import("bun").FileSink).end();
    },
    async waitFor(count: number) {
      while (lines.length < count)
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

const answer = (id: string, behavior: "allow" | "deny") =>
  `${JSON.stringify({ type: "control_response", response: { request_id: id, response: { behavior } } })}\n`;

test("a builder reply and a grader reply are played by role name, whatever the prompt says", async () => {
  install({
    roles: {
      builder: {
        exit: 0,
        replies: [[{ event: { type: "assistant", text: "B" } }]],
      },
      grader: {
        exit: 3,
        replies: [[{ event: { type: "assistant", text: "G" } }]],
      },
    },
  });
  for (const prompt of ["Implement the ticket", "Build the ticket"]) {
    const b = launch("builder");
    b.say(prompt);
    const built = await b.finish();
    expect(built.stdout[0]).toEqual({ type: "assistant", text: "B" });
    expect(built.code).toBe(0);
    rmSync(`${scriptPath}.launches.jsonl`);
  }
  const g = launch("grader");
  g.say("Grade the change");
  const graded = await g.finish();
  expect(graded.stdout[0]).toEqual({ type: "assistant", text: "G" });
  expect(graded.code).toBe(3);
});

test("each launch of a role plays the next reply, and a launch with none left fails", async () => {
  install({
    roles: {
      builder: { replies: [[{ event: { n: 1 } }], [{ event: { n: 2 } }]] },
      grader: { replies: [[{ event: { n: "g" } }]] },
    },
  });
  const seen: unknown[] = [];
  for (const role of ["builder", "grader", "builder"]) {
    const p = launch(role, [], "ignore");
    seen.push((await p.finish()).stdout[0]);
  }
  expect(seen).toEqual([{ n: 1 }, { n: "g" }, { n: 2 }]);
  const third = await launch("builder", [], "ignore").finish();
  expect(third.code).not.toBe(0);
  expect(third.stderr).toContain("role builder has 2 replies");
});

test("a chat role answers two messages with two replies and exits when its input closes", async () => {
  install({
    roles: {
      chat: { replies: [[{ event: { r: 1 } }], [{ event: { r: 2 } }]] },
    },
  });
  const chat = launch("chat");
  chat.say("M1");
  await chat.waitFor(2);
  expect(chat.lines.map((l) => JSON.parse(l).type ?? JSON.parse(l).r)).toEqual([
    1,
    "result",
  ]);
  chat.say("M2");
  await chat.waitFor(4);
  chat.close();
  const done = await chat.finish();
  expect(done.code).toBe(0);
  expect(done.stdout.filter((e) => "r" in e).map((e) => e.r)).toEqual([1, 2]);
  const messages = readRecords(`${scriptPath}.launches.jsonl`).filter(
    (r) => r.kind === "message",
  );
  expect(messages.map((m) => (m as { text: string }).text)).toEqual([
    "M1",
    "M2",
  ]);
});

test("a non-chat role with an ask exits after one reply with the script's exit code", async () => {
  install({
    roles: {
      builder: {
        exit: 7,
        replies: [
          [{ ask: { id: "a1", tool: "Bash" } }, { event: { after: true } }],
        ],
      },
    },
  });
  const b = launch("builder");
  b.say("go");
  await b.waitFor(2);
  expect(JSON.parse(b.lines[0] as string).request_id).toBe("a1");
  expect(b.lines).toHaveLength(2);
  b.send(answer("a1", "allow"));
  const done = await b.finish();
  expect(done.code).toBe(7);
  expect(done.stdout.map((e) => e.type)).toEqual([
    "control_request",
    undefined,
    "user",
    "result",
  ]);
  expect(done.stdout[2].message.content[0].is_error).toBe(false);
});

test("with no input channel an open ask is denied at the end of the turn", async () => {
  install({
    roles: { builder: { replies: [[{ ask: { id: "a1", tool: "Bash" } }]] } },
  });
  const done = await launch("builder", [], "ignore").finish();
  expect(done.code).toBe(0);
  expect(done.stdout.map((e) => e.type)).toEqual([
    "control_request",
    "user",
    "result",
  ]);
  expect(done.stdout[1].message.content[0].is_error).toBe(true);
});

test("an ask, a pause and a crash play before any answer, and the crash prints no result", async () => {
  install({
    roles: {
      builder: {
        replies: [
          [
            { ask: { id: "a1", tool: "Bash" } },
            { pause: 50 },
            { event: { late: 1 } },
            { crash: 9 },
          ],
        ],
      },
    },
  });
  const b = launch("builder");
  b.say("go");
  const done = await b.finish();
  expect(done.code).toBe(9);
  expect(done.stdout.map((e) => e.type)).toEqual([
    "control_request",
    undefined,
  ]);
});

test("a pause lasts its time plus a 20 ms margin", async () => {
  install({ roles: { builder: { replies: [[{ pause: 100 }]] } } });
  const start = performance.now();
  await launch("builder", [], "ignore").finish();
  const spawnOnly = performance.now() - start;
  expect(spawnOnly).toBeGreaterThanOrEqual(120);
});

test("an edit writes in the folder the agent started in", async () => {
  install({
    roles: {
      builder: { replies: [[{ edit: "src/a.txt", content: "hello" }]] },
    },
  });
  await launch("builder", [], "ignore").finish();
  expect(readFileSync(join(project, "src/a.txt"), "utf8")).toBe("hello");
});

test("an edit outside the project fails and leaves the outside file unchanged", async () => {
  const outside = join(dir, "x.txt");
  writeFileSync(outside, "before");
  install({
    roles: {
      builder: {
        replies: [
          [
            { edit: "ok.txt", content: "no" },
            { edit: "../x.txt", content: "after" },
          ],
        ],
      },
    },
  });
  const done = await launch("builder", [], "ignore").finish();
  expect(done.code).not.toBe(0);
  expect(done.stderr).toContain("../x.txt");
  expect(readFileSync(outside, "utf8")).toBe("before");
  expect(await Bun.file(join(project, "ok.txt")).exists()).toBe(false);
});

test("an edit through a link that points outside the project fails", async () => {
  const outside = join(dir, "elsewhere");
  mkdirSync(outside);
  await Bun.$`ln -s ${outside} ${join(project, "link")}`;
  install({
    roles: { builder: { replies: [[{ edit: "link/y.txt", content: "no" }]] } },
  });
  const done = await launch("builder", [], "ignore").finish();
  expect(done.code).not.toBe(0);
  expect(await Bun.file(join(outside, "y.txt")).exists()).toBe(false);
});

test("each launch leaves a record with its arguments and its role", async () => {
  install({ roles: { grader: { replies: [[]] } } });
  await launch("grader", ["-p", "--model", "x"], "ignore").finish();
  const [record] = readRecords(`${scriptPath}.launches.jsonl`);
  expect(record).toMatchObject({
    kind: "launch",
    role: "grader",
    args: ["-p", "--model", "x"],
  });
});

test("the fake with no script exits non-zero at once", async () => {
  const child = Bun.spawn(["bun", BIN], {
    cwd: project,
    env: { PATH: process.env.PATH ?? "" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await child.exited).not.toBe(0);
  expect(await new Response(child.stderr).text()).toContain(
    "no script installed",
  );
});

test("a launch with a script but no role fails", async () => {
  install({ roles: {} });
  const done = await launch(undefined, [], "ignore").finish();
  expect(done.code).not.toBe(0);
  expect(done.stderr).toContain("no role");
});

test("a scripted result line is the end of the reply, and the fake prints no second one", async () => {
  install({
    roles: {
      chat: {
        replies: [
          [
            {
              event: {
                type: "result",
                duration_ms: 1200,
                total_cost_usd: 0.04,
              },
            },
          ],
        ],
      },
    },
  });
  const c = launch("chat");
  c.say("hello");
  await c.waitFor(1);
  c.close();
  const done = await c.finish();
  expect(done.stdout).toEqual([
    { type: "result", duration_ms: 1200, total_cost_usd: 0.04 },
  ]);
});
