import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cleanEnv } from "../src/test-env/env.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

// Launch the fake agent as the app does: the program name "claude" found on PATH, a role in the env.
function launch(
  p: Project,
  role: string | undefined,
  args: string[],
  opts: { stdin?: "pipe" | "ignore"; withScript?: boolean } = {},
) {
  const env: Record<string, string> = { ...cleanEnv(process.env) } as Record<
    string,
    string
  >;
  if (opts.withScript !== false)
    env.WERK_FAKE_SCRIPT = join(dirname(p.dir), "script.json");
  if (role) env.WERK_AGENT_ROLE = role;
  const child = Bun.spawn(["claude", ...args], {
    cwd: p.dir,
    env,
    stdin: opts.stdin ?? "pipe",
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
  const sink = () => child.stdin as unknown as import("bun").FileSink;
  const msg = (text: string) =>
    `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;
  return {
    child,
    lines,
    say(text: string) {
      sink().write(msg(text));
      sink().flush();
    },
    send(line: string) {
      sink().write(line);
      sink().flush();
    },
    close() {
      sink().end();
    },
    async waitFor(n: number) {
      const t = Date.now();
      while (lines.length < n) {
        if (Date.now() - t > 8000) throw new Error(`timeout; lines=${lines}`);
        await new Promise<void>((w) => {
          waiters.push(w);
          setTimeout(w, 200);
        });
      }
    },
    async finish() {
      const code = await child.exited;
      await reading;
      return {
        code,
        out: lines.map((l) => JSON.parse(l)),
        stderr: await new Response(child.stderr).text(),
      };
    },
  };
}

test("03.1 roles get their own scripted replies, whatever the prompt says", async () => {
  const p = createProject({
    script: {
      roles: {
        builder: {
          replies: [
            [
              { edit: "NOTE.md", content: "builder note" },
              { event: { type: "assistant", text: "BUILDER" } },
            ],
          ],
        },
        grader: {
          replies: [[{ event: { type: "assistant", text: "GRADER" } }]],
        },
      },
    },
  });
  try {
    const b = launch(p, "builder", ["-p", "--model", "m1"]);
    b.say("Build the ticket");
    b.close();
    const built = await b.finish();
    expect(built.code).toBe(0);
    expect(built.out.some((e) => e.text === "BUILDER")).toBe(true);
    expect(readFileSync(join(p.dir, "NOTE.md"), "utf8")).toBe("builder note");
    const g = launch(p, "grader", ["-p", "--model", "m2"]);
    g.say("Grade it");
    g.close();
    const graded = await g.finish();
    expect(graded.out.some((e) => e.text === "GRADER")).toBe(true);
    expect(graded.out.some((e) => e.text === "BUILDER")).toBe(false);
    const launches = p.launches().filter((r) => r.kind === "launch");
    expect(launches).toHaveLength(2);
    expect(launches[0]).toMatchObject({
      role: "builder",
      args: ["-p", "--model", "m1"],
    });
    expect(launches[1]).toMatchObject({
      role: "grader",
      args: ["-p", "--model", "m2"],
    });
  } finally {
    await p.dispose();
  }
});

test("03.2 a chat answers two messages and ends when its input closes", async () => {
  const p = createProject({
    script: {
      roles: {
        chat: {
          replies: [
            [{ event: { type: "assistant", text: "R1" } }],
            [{ event: { type: "assistant", text: "R2" } }],
          ],
        },
      },
    },
  });
  try {
    const c = launch(p, "chat", ["-p"]);
    c.say("M1");
    await c.waitFor(3); // init, reply, result
    expect(c.lines.join("\n")).toContain("R1");
    expect(c.lines.join("\n")).not.toContain("R2");
    expect(c.child.exitCode).toBeNull(); // stays open
    c.say("M2");
    await c.waitFor(5);
    expect(c.lines.join("\n")).toContain("R2");
    expect(c.child.exitCode).toBeNull();
    c.close();
    const done = await c.finish();
    expect(done.code).toBe(0);
  } finally {
    await p.dispose();
  }
});

test("03.3 a crash after an open ask prints no final result", async () => {
  const p = createProject({
    script: {
      roles: {
        builder: {
          replies: [
            [
              { ask: { id: "a1", tool: "Bash", input: { command: "ls" } } },
              { pause: 50 },
              { event: { type: "assistant", text: "AFTER" } },
              { crash: 9 },
            ],
          ],
        },
      },
    },
  });
  try {
    const b = launch(p, "builder", ["-p"]);
    b.say("go");
    const done = await b.finish();
    expect(done.out[0].type).toBe("control_request");
    expect(done.out[0].request.tool_name).toBe("Bash");
    // The step after the ask plays before any answer was given.
    expect(done.out[1]).toMatchObject({ text: "AFTER" });
    expect(done.out.some((e) => e.type === "user")).toBe(false); // no tool result
    expect(done.out.some((e) => e.type === "result")).toBe(false); // no final result
    expect(done.code).not.toBe(0);
  } finally {
    await p.dispose();
  }
});

test("03.4 an ask ends after one reply; a bad edit path changes nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "p1-outside-"));
  const outside = join(root, "outside.txt");
  writeFileSync(outside, "known content");
  const p = createProject({
    script: {
      roles: {
        builder: {
          exit: 0,
          replies: [
            [
              { ask: { id: "a1", tool: "Edit" } },
              { edit: outside, content: "CHANGED" },
            ],
          ],
        },
      },
    },
  });
  try {
    const b = launch(p, "builder", ["-p"]);
    b.say("go");
    // The user answers the permission request (if the agent shows one).
    b.send(
      `${JSON.stringify({ type: "control_response", response: { request_id: "a1", response: { behavior: "allow" } } })}\n`,
    );
    b.close();
    const done = await b.finish();
    console.log("P1DBG", done.code, JSON.stringify(done.out), done.stderr);
    expect(done.out.some((e) => e.type === "control_request")).toBe(true);
    expect(done.code).toBe(0 as number);
    // The edit step is reported as failed.
    expect(done.stderr).toContain(outside);
    expect(readFileSync(outside, "utf8")).toBe("known content");
    expect(p.launches().filter((r) => r.kind === "launch")).toHaveLength(1);
  } finally {
    await p.dispose();
  }
});

test("03.5 with no script the fake agent fails at once", async () => {
  const p = createProject();
  try {
    expect(existsSync(join(dirname(p.dir), "script.json"))).toBe(false);
    const b = launch(p, "builder", ["-p"], {
      stdin: "ignore",
      withScript: false,
    });
    const t = Date.now();
    const done = await b.finish();
    expect(Date.now() - t).toBeLessThan(5000);
    expect(done.code).not.toBe(0);
    expect(done.out).toHaveLength(0);
    expect(done.stderr).toContain("no script");
  } finally {
    await p.dispose();
  }
});
