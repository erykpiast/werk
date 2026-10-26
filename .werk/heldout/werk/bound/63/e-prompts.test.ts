// Held-out steps 19.1, 19.3, 19.4 and 19.5.
import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshProject } from "../src/test/project.ts";

const CHECKOUT = join(import.meta.dir, "..");

/** The person starts a build pass on a ticket: werk must offer a verb for it. */
async function startBuildPass(p: ReturnType<typeof freshProject>, ticket: string) {
  const help = await p.werk(["help"]);
  expect(help.out).toMatch(/^ {2}build\b/m);
  return p.werk(["build", ticket]);
}

test("19.1", async () => {
  const p = freshProject();
  await p.werk(["add", "how", "--title", "How it is built"]);
  await p.werk(["accept", "how", "--actor", "you"]);
  const build = await startBuildPass(p, "tickets/01.md");
  expect(build.code).toBe(0);
  expect(p.launches().some((l) => l.role === "builder")).toBe(true);
});

test("19.3", async () => {
  const p = freshProject();
  await p.werk(["add", "how", "--title", "How it is built"]);
  await p.werk(["accept", "how", "--actor", "you"]);
  const build = await startBuildPass(p, "tickets/01.md");
  expect(build.code).toBe(0);
});

test("19.4", async () => {
  expect(readFileSync(join(CHECKOUT, "AGENTS.md"), "utf8")).toContain("@src/agent/instructions.md");
  const p = freshProject();
  const build = await startBuildPass(p, "tickets/01.md");
  expect(build.code).toBe(0);
});

test("19.5", async () => {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-links-"));
  try {
    const copy = join(root, "werk");
    cpSync(CHECKOUT, copy, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => !/\/(node_modules|\.git|\.werk-heldout|test-results)$/.test(src),
    });
    symlinkSync(join(CHECKOUT, "node_modules"), join(copy, "node_modules"));
    // The repository check that judges the subagent links runs inside the unit tests.
    const check = () =>
      Bun.spawnSync([process.execPath, "test", "scripts/subagent-links.test.ts"], {
        cwd: copy,
        stdout: "pipe",
        stderr: "pipe",
      });
    const first = check();
    expect(first.exitCode).toBe(0);

    const link = join(copy, ".claude", "agents", "test-scope.md");
    const text = readFileSync(link, "utf8");
    rmSync(link);
    await Bun.write(link, text);
    const broken = check();
    const output = broken.stdout.toString() + broken.stderr.toString();
    expect(broken.exitCode).not.toBe(0);
    expect(output).toContain("test-scope");

    rmSync(link);
    symlinkSync(join("..", "..", "src", "agent", "subagents", "test-scope.md"), link);
    expect(check().exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
