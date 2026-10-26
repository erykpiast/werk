// The fake agent at its seam: a process found as `claude`, its output stream, its files and its
// exit code (#werk-v0-seams-fake-script, #werk-test-fake-ask-open, #werk-chat-fake-role).
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { freshProject, type Project } from "./project.ts";

const STREAM = ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];

const message = (text: string) => `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;
const answer = (id: string) =>
  `${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: id } })}\n`;

/** The lines of a stream, read one at a time. */
function lineReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return async (): Promise<unknown> => {
    while (!buffer.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) return undefined;
      buffer += decoder.decode(value, { stream: true });
    }
    const at = buffer.indexOf("\n");
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    return JSON.parse(line);
  };
}

function agent(project: Project, role: string, args: string[] = STREAM) {
  const proc = project.start(["claude", ...args], { env: { WERK_ROLE: role } });
  return { proc, next: lineReader(proc.stdout) };
}

const lines = (out: string) =>
  out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));

test("with no script the fake exits with an error", async () => {
  const project = freshProject();
  const run = await project.run(["claude", "-p", "hello"], { env: { WERK_ROLE: "builder" } });
  expect(run.code).toBe(1);
  expect(run.err).toStartWith("fake agent: no script installed");
  expect(run.out).toBe("");
});

test("a build pass plays its events and edits in order, then exits with the script's code", async () => {
  const project = freshProject();
  project.script({
    roles: {
      builder: {
        replies: [
          [
            { event: { type: "assistant", n: 1 } },
            { edit: { path: "src/a.txt", content: "A" } },
            { event: { type: "assistant", n: 2 } },
          ],
        ],
        exit: 4,
      },
    },
  });
  const { proc, next } = agent(project, "builder");
  proc.stdin.write(message("Implement the ticket"));
  proc.stdin.flush();
  expect(await next()).toEqual({ type: "assistant", n: 1 });
  expect(await next()).toEqual({ type: "assistant", n: 2 });
  // The edit happened between the two events, so it is on disk when the second one arrives.
  expect(readFileSync(join(project.dir, "src", "a.txt"), "utf8")).toBe("A");
  expect(await next()).toMatchObject({ type: "result" });
  // The input is still open: a build pass ends after its one reply, not when its input closes.
  expect(await proc.exited).toBe(4);
});

test("an edit that leads outside the project fails and writes nothing", async () => {
  const project = freshProject();
  const outside = join(dirname(project.dir), "outside.txt");
  const paths = ["../outside.txt", outside];
  // Each launch of the role plays the next reply, so each path has a reply of its own.
  project.script({
    roles: {
      builder: { replies: paths.map((path) => [{ edit: { path, content: "X" } }, { event: { type: "never" } }]) },
    },
  });
  for (const path of paths) {
    const run = await project.run(["claude", "-p", "go"], { env: { WERK_ROLE: "builder" } });
    expect(run.code).toBe(1);
    expect(run.err).toContain(`the edit ${path} leads outside the project`);
    expect(run.out).toBe("");
    expect(existsSync(outside)).toBe(false);
  }
});

test("an edit through a link that leads outside the project fails and writes nothing", async () => {
  const project = freshProject();
  await project.run(["ln", "-s", dirname(project.dir), join(project.dir, "up")]);
  project.script({ roles: { builder: { replies: [[{ edit: { path: "up/outside.txt", content: "X" } }]] } } });
  const run = await project.run(["claude", "-p", "go"], { env: { WERK_ROLE: "builder" } });
  expect(run.code).toBe(1);
  expect(existsSync(join(dirname(project.dir), "outside.txt"))).toBe(false);
});

test("an ask does not block the steps after it, and the result waits for its answer", async () => {
  const project = freshProject();
  project.script({
    roles: {
      builder: {
        replies: [[{ ask: { id: "a1", tool: "Bash", input: { command: "ls" } } }, { event: { type: "after-ask" } }]],
      },
    },
  });
  const { proc, next } = agent(project, "builder");
  proc.stdin.write(message("Implement the ticket"));
  proc.stdin.flush();
  expect(await next()).toMatchObject({ type: "control_request", request_id: "a1", request: { tool_name: "Bash" } });
  expect(await next()).toEqual({ type: "after-ask" });
  // The answer is part of the same reply: the pass prints its result and exits, with no new turn.
  proc.stdin.write(answer("a1"));
  proc.stdin.flush();
  expect(await next()).toMatchObject({ type: "result", denied_requests: [] });
  expect(await proc.exited).toBe(0);
  expect(project.launches()[0]?.messages).toHaveLength(1);
});

test("a crash with an ask open exits with no final result", async () => {
  const project = freshProject();
  project.script({
    roles: { builder: { replies: [[{ ask: { tool: "Bash" } }, { event: { type: "tool_use" } }, { crash: 3 }]] } },
  });
  const run = await project.run(["claude", ...STREAM], { env: { WERK_ROLE: "builder" }, stdin: message("go") });
  expect(run.code).toBe(3);
  expect(lines(run.out).map((event) => event.type)).toEqual(["control_request", "tool_use"]);
});

test("with no input channel an open ask is denied at the end of the turn", async () => {
  const project = freshProject();
  project.script({ roles: { grader: { replies: [[{ ask: { id: "a1", tool: "Bash" } }]] } } });
  const run = await project.run(["claude", "-p", "Grade the change"], { env: { WERK_ROLE: "grader" } });
  expect(run.code).toBe(0);
  expect(lines(run.out).map((event) => event.type)).toEqual(["control_request", "result"]);
  expect(lines(run.out)[1]).toMatchObject({ denied_requests: ["a1"] });
});

test("a pause lasts at least the scripted time plus a 20 ms margin", async () => {
  const project = freshProject();
  project.script({
    roles: { builder: { replies: [[{ event: { type: "a" } }, { pause: 50 }, { event: { type: "b" } }]] } },
  });
  const { proc, next } = agent(project, "builder", ["-p", "go"]);
  await next();
  const before = performance.now();
  await next();
  expect(performance.now() - before).toBeGreaterThanOrEqual(70);
  await proc.exited;
});

test("each launch is recorded with its arguments, its role and the messages it read", async () => {
  const project = freshProject();
  project.script({ roles: { builder: { replies: [[], []] }, grader: { replies: [[]] } } });
  await project.run(["claude", ...STREAM], { env: { WERK_ROLE: "builder" }, stdin: message("P1") });
  await project.run(["claude", "-p", "Grade the change"], { env: { WERK_ROLE: "grader" } });
  await project.run(["claude", ...STREAM], { env: { WERK_ROLE: "builder" }, stdin: message("P2") });
  const launches = project.launches();
  expect(launches.map(({ args, role }) => ({ args, role }))).toEqual([
    { args: STREAM, role: "builder" },
    { args: ["-p", "Grade the change"], role: "grader" },
    { args: STREAM, role: "builder" },
  ]);
  expect(launches[0]?.messages).toEqual([JSON.parse(message("P1"))]);
  expect(launches[1]?.messages).toEqual(["Grade the change"]);
});

test("the next launch of a role plays the role's next reply, and a launch past the last reply fails", async () => {
  const project = freshProject();
  project.script({ roles: { builder: { replies: [[{ event: { pass: 1 } }], [{ event: { pass: 2 } }]] } } });
  const run = () => project.run(["claude", "-p", "go"], { env: { WERK_ROLE: "builder" } });
  expect(lines((await run()).out)[0]).toEqual({ pass: 1 });
  expect(lines((await run()).out)[0]).toEqual({ pass: 2 });
  const third = await run();
  expect(third.code).toBe(1);
  expect(third.err).toContain("the script has 2 replies for the role builder");
});

test("a launch whose role the script does not name fails", async () => {
  const project = freshProject();
  project.script({ roles: { builder: { replies: [[]] } } });
  const run = await project.run(["claude", "-p", "go"], { env: { WERK_ROLE: "reviewer" } });
  expect(run.code).toBe(1);
  expect(run.err).toContain("the script has no replies for the role reviewer");
});

test("a chat agent answers each message in turn and exits when its input closes", async () => {
  const project = freshProject();
  project.script({
    roles: { chat: { replies: [[{ event: { reply: "R1" } }], [{ event: { reply: "R2" } }]], exit: 0 } },
  });
  const { proc, next } = agent(project, "chat");
  proc.stdin.write(message("M1"));
  proc.stdin.flush();
  expect(await next()).toEqual({ reply: "R1" });
  expect(await next()).toMatchObject({ type: "result" });
  proc.stdin.write(message("M2"));
  proc.stdin.flush();
  expect(await next()).toEqual({ reply: "R2" });
  expect(await next()).toMatchObject({ type: "result" });
  expect(proc.exitCode).toBeNull();
  await proc.stdin.end();
  expect(await proc.exited).toBe(0);
  expect(project.launches()[0]?.messages).toEqual([JSON.parse(message("M1")), JSON.parse(message("M2"))]);
});

test("a chat agent with no input stream fails", async () => {
  const project = freshProject();
  project.script({ roles: { chat: { replies: [[]] } } });
  const run = await project.run(["claude", "-p", "hi"], { env: { WERK_ROLE: "chat" } });
  expect(run.code).toBe(1);
  expect(run.err).toContain("a chat agent reads its messages from an input stream");
});

test("a script that cannot be read fails the launch", async () => {
  const project = freshProject();
  project.script({ roles: { builder: { replies: [[{ dance: 1 }]] } } } as never);
  const run = await project.run(["claude", "-p", "go"], { env: { WERK_ROLE: "builder" } });
  expect(run.code).toBe(1);
  expect(run.err).toContain("the script cannot be read: role builder, reply 1, step 1: unknown step dance");
});
