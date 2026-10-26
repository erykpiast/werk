import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
import { readRecords } from "../../src/fake-agent/launch-log.ts";
import type { Script } from "../../src/fake-agent/script.ts";
import { cleanEnv } from "../../src/test-env/env.ts";

const BIN = join(import.meta.dir, "../../fake/claude");
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
const records = () => readRecords(`${scriptPath}.launches.jsonl`);

function launch(role: string | undefined, args: string[] = [], withScript = true) {
  const env: Record<string, string> = { ...(cleanEnv(process.env) as Record<string, string>) };
  if (withScript) env.WERK_FAKE_SCRIPT = scriptPath;
  if (role) env.WERK_AGENT_ROLE = role;
  const child = Bun.spawn(["bun", BIN, ...args], {
    cwd: project,
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
  const send = (l: string) => {
    child.stdin.write(l);
    child.stdin.flush();
  };
  return {
    lines,
    send,
    say: (t: string) =>
      send(`${JSON.stringify({ type: "user", message: { role: "user", content: t } })}\n`),
    answer: (id: string) =>
      send(
        `${JSON.stringify({ type: "control_response", response: { request_id: id, response: { behavior: "allow" } } })}\n`,
      ),
    close: () => child.stdin.end(),
    async waitFor(n: number, ms = 4000) {
      const end = Date.now() + ms;
      while (lines.length < n && Date.now() < end)
        await Promise.race([
          new Promise<void>((w) => waiters.push(w)),
          new Promise((r) => setTimeout(r, 100)),
        ]);
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

describe("03 fake agent", () => {
  test("03.1 roles get their own scripted replies whatever the prompt says", async () => {
    install({
      roles: {
        builder: {
          replies: [[{ edit: "NOTE.md", content: "note" }, { event: { type: "assistant", text: "B" } }]],
        },
        grader: { replies: [[{ event: { type: "assistant", text: "G" } }]] },
      },
    });
    const b = launch("builder", ["-p", "--model", "m"]);
    b.say("Build the ticket");
    const built = await b.finish();
    b.close;
    expect(built.out[0]).toEqual({ type: "assistant", text: "B" });
    expect(readFileSync(join(project, "NOTE.md"), "utf8")).toBe("note");
    const g = launch("grader", ["--tools", "x"]);
    g.say("Grade it");
    const graded = await g.finish();
    expect(graded.out[0]).toEqual({ type: "assistant", text: "G" });
    const launches = records().filter((r) => r.kind === "launch");
    expect(launches.map((l) => l.role)).toEqual(["builder", "grader"]);
    expect(launches[0]?.args).toEqual(["-p", "--model", "m"]);
    expect(launches[1]?.args).toEqual(["--tools", "x"]);
  });

  test("03.2 chat answers two messages and exits when input closes", async () => {
    install({ roles: { chat: { replies: [[{ event: { r: 1 } }], [{ event: { r: 2 } }]] } } });
    const c = launch("chat");
    c.say("M1");
    expect(await c.waitFor(3)).toBe(true);
    expect(c.lines.map((l) => JSON.parse(l)).some((e) => e.r === 1)).toBe(true);
    expect(c.lines.map((l) => JSON.parse(l)).some((e) => e.r === 2)).toBe(false);
    c.say("M2");
    expect(await c.waitFor(5)).toBe(true);
    c.close();
    const done = await c.finish();
    expect(done.code).toBe(0);
    expect(done.out.filter((e) => "r" in e).map((e) => e.r)).toEqual([1, 2]);
  });

  test("03.3 crash after an open ask prints no final result", async () => {
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
    expect(JSON.parse(done.out[0] ? JSON.stringify(done.out[0]) : "{}").request_id).toBe("a1");
    expect(done.out[1]).toEqual({ late: 1 });
    expect(done.code).toBe(9);
    expect(done.out.some((e) => e.type === "user")).toBe(false);
    expect(done.out.some((e) => e.type === "result")).toBe(false);
  });

  test("03.4 ask + edit outside the project + exit 0", async () => {
    const outside = join(dir, "outside.txt");
    writeFileSync(outside, "known");
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
    const sawAsk = await b.waitFor(1, 3000);
    if (sawAsk) b.answer("a1");
    else b.close();
    const done = await b.finish();
    expect(readFileSync(outside, "utf8")).toBe("known");
    expect(sawAsk).toBe(true);
    expect(done.code).toBe(0);
    expect(done.err).toContain("outside.txt");
  });

  test("03.5 with no script the fake fails at once", async () => {
    const f = launch("builder", [], false);
    const done = await f.finish();
    expect(done.code).not.toBe(0);
    expect(done.out).toEqual([]);
    expect(done.err).toContain("no script");
  });
});
