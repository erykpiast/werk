import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanEnv } from "../../src/test-env/env.ts";
import { type Project, withProject } from "../../src/test-env/project.ts";
import type { Script } from "../../src/fake-agent/script.ts";

type Line = Record<string, any>;

/** Starts the fake agent as `claude` the way the product does: role in the environment, input piped. */
function agent(project: Project, role: string | null, args: string[] = []) {
  const env: Record<string, string> = {
    ...cleanEnv(process.env),
    WERK_FAKE_SCRIPT: join(project.dir, "..", "script.json"),
  };
  if (role) env.WERK_AGENT_ROLE = role;
  const child = Bun.spawn(["claude", ...args], {
    cwd: project.dir,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const lines: Line[] = [];
  const waiters: (() => void)[] = [];
  const reading = (async () => {
    const dec = new TextDecoder();
    let rest = "";
    for await (const chunk of child.stdout) {
      rest += dec.decode(chunk, { stream: true });
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      for (const p of parts) if (p) lines.push(JSON.parse(p));
      for (const w of waiters.splice(0)) w();
    }
    for (const w of waiters.splice(0)) w();
  })();
  const stdin = child.stdin as import("bun").FileSink;
  const send = (text: string) => {
    stdin.write(text);
    stdin.flush();
  };
  return {
    child,
    lines,
    say: (text: string) =>
      send(`${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`),
    answer: (id: string, behavior: "allow" | "deny") =>
      send(
        `${JSON.stringify({ type: "control_response", response: { request_id: id, response: { behavior } } })}\n`,
      ),
    close: () => stdin.end(),
    /** Waits until `count` lines exist, or `ms` pass. */
    async waitLines(count: number, ms = 5000) {
      const end = Date.now() + ms;
      while (lines.length < count && Date.now() < end)
        await Promise.race([
          new Promise<void>((w) => waiters.push(w)),
          new Promise<void>((w) => setTimeout(w, 100)),
        ]);
    },
    async finish() {
      const code = await child.exited;
      await reading;
      return { code, stderr: await new Response(child.stderr).text() };
    },
  };
}

const install = (p: Project, s: Script) =>
  writeFileSync(join(p.dir, "..", "script.json"), JSON.stringify(s));

test("03.1 roles get their own scripted replies, whatever the prompt says", async () => {
  await withProject({}, async (project) => {
    install(project, {
      roles: {
        builder: {
          replies: [
            [
              { edit: "note.txt", content: "a note" },
              { event: { type: "assistant", text: "BUILDER" } },
            ],
          ],
        },
        grader: { replies: [[{ event: { type: "assistant", text: "GRADER-PASS" } }]] },
      },
    });
    const b = agent(project, "builder", ["-p", "--model", "x"]);
    b.say("Build the ticket");
    const built = await b.finish();
    expect(built.code).toBe(0);
    expect(b.lines[0]).toEqual({ type: "assistant", text: "BUILDER" });
    expect(readFileSync(join(project.dir, "note.txt"), "utf8")).toBe("a note");
    const g = agent(project, "grader", ["--tools", "Read"]);
    g.say("Grade the ticket");
    await g.finish();
    expect(g.lines[0]).toEqual({ type: "assistant", text: "GRADER-PASS" });
    const launches = project.launches().filter((r) => r.kind === "launch");
    expect(launches).toHaveLength(2);
    expect(launches[0]).toMatchObject({ role: "builder", args: ["-p", "--model", "x"] });
    expect(launches[1]).toMatchObject({ role: "grader", args: ["--tools", "Read"] });
  });
});

test("03.2 a chat answers two messages and ends when its input closes", async () => {
  await withProject({}, async (project) => {
    install(project, {
      roles: {
        chat: {
          replies: [[{ event: { r: 1 } }], [{ event: { r: 2 } }]],
        },
      },
    });
    const c = agent(project, "chat");
    c.say("first");
    await c.waitLines(3);
    expect(c.lines.some((l) => l.r === 1)).toBe(true);
    expect(c.lines.some((l) => l.type === "result")).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(c.child.exitCode).toBeNull(); // still open
    c.say("second");
    await c.waitLines(5);
    expect(c.lines.some((l) => l.r === 2)).toBe(true);
    expect(c.child.exitCode).toBeNull();
    c.close();
    const done = await c.finish();
    expect(done.code).toBe(0);
  });
});

test("03.3 a crash after an open ask prints no final result", async () => {
  await withProject({}, async (project) => {
    install(project, {
      roles: {
        builder: {
          replies: [
            [
              { ask: { id: "a1", tool: "Bash" } },
              { pause: 50 },
              { event: { late: true } },
              { crash: 9 },
            ],
          ],
        },
      },
    });
    const b = agent(project, "builder");
    b.say("go");
    const done = await b.finish();
    expect(b.lines[0]?.type).toBe("control_request");
    expect(b.lines[0]?.request_id).toBe("a1");
    // the step after the ask played before any answer was sent
    expect(b.lines[1]).toEqual({ late: true });
    expect(done.code).toBe(9);
    expect(b.lines.some((l) => l.type === "user")).toBe(false);
    expect(b.lines.some((l) => l.type === "result")).toBe(false);
  });
});

test("03.4 a build with an ask ends after one reply, and a bad edit path changes nothing", async () => {
  await withProject({}, async (project) => {
    const outside = join(project.dir, "..", "outside.txt");
    writeFileSync(outside, "known");
    install(project, {
      roles: {
        builder: {
          exit: 0,
          replies: [
            [
              { ask: { id: "a1", tool: "Edit" } },
              { edit: "../outside.txt", content: "changed" },
            ],
          ],
        },
      },
    });
    const b = agent(project, "builder");
    b.say("go");
    await b.waitLines(1);
    expect(b.lines[0]?.type).toBe("control_request");
    b.answer("a1", "allow");
    const done = await b.finish();
    expect(done.code).toBe(0);
    expect(done.stderr).toContain("outside.txt");
    expect(readFileSync(outside, "utf8")).toBe("known");
  });
});

test("03.5 with no script the fake agent fails at once", async () => {
  await withProject({}, async (project) => {
    const env = { ...cleanEnv(process.env), WERK_AGENT_ROLE: "builder" };
    const child = Bun.spawn(["claude", "-p"], {
      cwd: project.dir,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const start = Date.now();
    const code = await child.exited;
    expect(Date.now() - start).toBeLessThan(5000);
    expect(code).not.toBe(0);
    expect(await new Response(child.stdout).text()).toBe("");
    expect(await new Response(child.stderr).text()).toContain("no script");
  });
});
