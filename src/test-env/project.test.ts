import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FAKE_DIR, fakeIsFirst } from "./env.ts";
import { createProject, useProject, withProject } from "./project.ts";

describe("the cleaned environment", () => {
  test("a spawn with no environment of its own starts the fake agent", async () => {
    const child = Bun.spawn(["claude", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(child.stderr).text();
    // With no script installed the fake exits with an error and names itself.
    expect(await child.exited).not.toBe(0);
    expect(stderr).not.toBe("");
    expect(Bun.which("claude")).toBe(join(FAKE_DIR, "claude"));
  });

  test("the shell finds the fake agent first", async () => {
    const out = await Bun.$`command -v claude`.text();
    expect(out.trim()).toBe(join(FAKE_DIR, "claude"));
  });

  test("no variable that points at a real project is set", () => {
    expect(
      Object.keys(process.env).filter((k) => k.startsWith("WERK_")),
    ).toEqual([]);
    expect(fakeIsFirst(process.env.PATH)).toBe(true);
  });
});

describe("a fresh project", () => {
  test("has a git repository, no map events, and no target unless asked", async () => {
    await withProject({}, async (project) => {
      const git = await project.run([
        "git",
        "rev-parse",
        "--is-inside-work-tree",
      ]);
      expect(git.stdout.trim()).toBe("true");
      expect(project.events()).toEqual([]);
      expect(project.target).toBeUndefined();
    });
  });

  test("a target repository is a second git repository", async () => {
    await withProject({ target: true }, async (project) => {
      const target = project.target as string;
      expect(target).not.toBe(project.dir);
      const git = await project.run([
        "git",
        "-C",
        target,
        "rev-parse",
        "--git-dir",
      ]);
      expect(git.code).toBe(0);
    });
  });

  test("a failing test leaves no directory behind", async () => {
    let dir = "";
    let target = "";
    await expect(
      withProject({ target: true }, (project) => {
        dir = project.dir;
        target = project.target as string;
        throw new Error("the test fails");
      }),
    ).rejects.toThrow("the test fails");
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(target)).toBe(false);
  });

  test("dispose stops a process the harness started", async () => {
    let pid = 0;
    await withProject({}, (project) => {
      const child = project.start(["sleep", "60"]);
      pid = child.pid;
    });
    expect(() => process.kill(pid, 0)).toThrow();
  });

  test("the fake agent replays the installed script and records its launch", async () => {
    await withProject(
      { script: { roles: { builder: { replies: [[]] } } } },
      async (project) => {
        const result = await project.run(["claude", "-p"], {
          WERK_AGENT_ROLE: "builder",
        });
        expect(result.code).toBe(0);
        expect(project.launches()).toMatchObject([
          { kind: "launch", role: "builder" },
        ]);
      },
    );
  });
});

describe("isolation between tests", () => {
  const project = useProject();

  test("one writes its log", () => {
    writeFileSync(project().logPath, `${JSON.stringify({ type: "added" })}\n`);
    writeFileSync(join(project().dir, "mark"), "a");
    expect(project().events()).toHaveLength(1);
  });

  test("another sees none of it", () => {
    expect(project().events()).toEqual([]);
    expect(existsSync(join(project().dir, "mark"))).toBe(false);
    expect(readFileSync(join(project().dir, ".git/HEAD"), "utf8")).toContain(
      "main",
    );
  });
});

test("createProject gives each call its own directory", async () => {
  const a = createProject();
  const b = createProject();
  try {
    expect(a.dir).not.toBe(b.dir);
  } finally {
    await a.dispose();
    await b.dispose();
  }
});
