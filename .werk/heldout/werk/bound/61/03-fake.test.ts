import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeEnv } from "./fake.ts";

let f: ReturnType<typeof fakeEnv>;
beforeEach(() => {
  f = fakeEnv();
});
afterEach(() => f.dispose());

const ev = (o: Record<string, unknown>) => ({ event: o });
const answer = (id: string, behavior: "allow" | "deny") =>
  `${JSON.stringify({ type: "control_response", response: { request_id: id, response: { behavior } } })}\n`;

test("03.1 roles play their own scripted replies whatever the prompt says, and the record lists each launch", async () => {
  f.install({
    roles: {
      builder: { replies: [[{ edit: "note.txt", content: "a note" }, ev({ type: "assistant", text: "B" })]] },
      grader: { replies: [[ev({ type: "assistant", text: "G pass" })]] },
    },
  });
  const b = f.launch("builder", ["-p", "--model", "x"]);
  b.say("Build the ticket");
  const built = await b.finish();
  expect(built.code).toBe(0);
  expect(built.stdout[0]).toEqual({ type: "assistant", text: "B" });
  expect(readFileSync(join(f.project, "note.txt"), "utf8")).toBe("a note");
  const g = f.launch("grader", ["--tools", "Read"]);
  g.say("Grade the change");
  const graded = await g.finish();
  expect(graded.stdout[0]).toEqual({ type: "assistant", text: "G pass" });
  const launches = f.records().filter((r) => r.kind === "launch");
  expect(launches).toHaveLength(2);
  expect(launches[0]).toMatchObject({ role: "builder", args: ["-p", "--model", "x"] });
  expect(launches[1]).toMatchObject({ role: "grader", args: ["--tools", "Read"] });
});

test("03.2 a chat answers two messages and exits when its input closes", async () => {
  f.install({
    roles: {
      chat: {
        replies: [
          [ev({ type: "assistant", text: "one" }), ev({ type: "result", subtype: "success", is_error: false, result: "one" })],
          [ev({ type: "assistant", text: "two" }), ev({ type: "result", subtype: "success", is_error: false, result: "two" })],
        ],
      },
    },
  });
  const c = f.launch("chat");
  c.say("first");
  // init line, assistant, result
  expect(await c.waitFor(3)).toBe(true);
  expect(c.lines.join("\n")).toContain('"text":"one"');
  expect(c.child.exitCode).toBeNull();
  c.say("second");
  expect(await c.waitFor(5)).toBe(true);
  expect(c.lines.join("\n")).toContain('"text":"two"');
  expect(c.child.exitCode).toBeNull();
  c.close();
  const done = await c.finish();
  expect(done.code).toBe(0);
});

test("03.3 a crash after an open ask prints no tool result and no final result", async () => {
  f.install({
    roles: {
      builder: {
        replies: [[{ ask: { id: "a1", tool: "Bash", input: { command: "ls" } } }, { pause: 100 }, ev({ type: "assistant", text: "after" }), { crash: 3 }]],
      },
    },
  });
  const b = f.launch("builder");
  b.say("go");
  const done = await b.finish();
  const types = done.stdout.map((o) => o.type);
  expect(types).toContain("control_request");
  expect(JSON.stringify(done.stdout)).toContain("after");
  expect(types.indexOf("control_request")).toBeLessThan(JSON.stringify(done.stdout).indexOf("after"));
  expect(JSON.stringify(done.stdout)).not.toContain("tool_result");
  expect(types).not.toContain("result");
  expect(done.code).toBe(3);
});

test("03.4 an ask, an edit outside the project and exit 0: one reply, edit failed, outside file unchanged", async () => {
  const outside = join(f.dir, "x.txt");
  writeFileSync(outside, "before");
  f.install({
    roles: {
      builder: { exit: 0, replies: [[{ ask: { id: "p1", tool: "Bash", input: { command: "ls" } } }, { edit: "../x.txt", content: "after" }]] },
    },
  });
  const b = f.launch("builder");
  b.say("go");
  const sawAsk = await b.waitFor(1, 3000);
  if (sawAsk) b.send(answer("p1", "allow"));
  const done = await Promise.race([b.finish(), Bun.sleep(8000).then(() => null)]);
  expect(readFileSync(outside, "utf8")).toBe("before");
  // The step wants: the permission request appears and, after the answer, the build ends with the script's exit code 0.
  expect(sawAsk).toBe(true);
  expect(done?.code).toBe(0);
  expect(done?.stderr ?? "").toContain("../x.txt");
  b.child.kill();
});

test("03.5 with no script the fake agent fails at once and plays no reply", async () => {
  const c = f.launch("builder", [], false);
  const done = await c.finish();
  expect(done.code).not.toBe(0);
  expect(done.stdout).toEqual([]);
  expect(done.stderr).toContain("no script installed");
  expect(existsSync(`${f.scriptPath}.launches.jsonl`)).toBe(false);
});
