// Named behaviours of the post-edit hook (#werk-cc-hooks). Each test edits a file in its own
// temporary project that holds a copy of the lint configuration (#werk-test-store).
import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const hook = join(import.meta.dir, "format-hook.ts");
const projects: string[] = [];

afterEach(() => {
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-hook-"));
  projects.push(dir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  copyFileSync(join(root, "biome.json"), join(dir, "biome.json"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

function runHook(dir: string, filePath: string): { code: number; stderr: string } {
  const input = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: filePath },
  });
  const run = Bun.spawnSync([process.execPath, hook], {
    stdin: new TextEncoder().encode(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: run.exitCode, stderr: run.stderr.toString() };
}

describe("format-and-lint hook", () => {
  test("formats the edited file and returns nothing when no error remains", () => {
    const dir = project({ "a.ts": "export   const a=1\n" });
    const { code, stderr } = runHook(dir, join(dir, "a.ts"));
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe("export const a = 1;\n");
  });

  test("returns the errors that remain to the agent", () => {
    const dir = project({ "b.ts": "export function b(p:any){return p}\n" });
    const { code, stderr } = runHook(dir, join(dir, "b.ts"));
    expect(code).toBe(2);
    expect(stderr).toContain("noExplicitAny");
    expect(readFileSync(join(dir, "b.ts"), "utf8")).toBe("export function b(p: any) {\n  return p;\n}\n");
  });

  test("touches only the edited file", () => {
    const dir = project({ "a.ts": "export   const a=1\n", "other.ts": "export   const o=1\n" });
    runHook(dir, join(dir, "a.ts"));
    expect(readFileSync(join(dir, "other.ts"), "utf8")).toBe("export   const o=1\n");
  });

  test("ignores a file outside the project", () => {
    const dir = project({});
    const outside = project({ "c.ts": "export   const c=1\n" });
    const { code } = runHook(dir, join(outside, "c.ts"));
    expect(code).toBe(0);
    expect(readFileSync(join(outside, "c.ts"), "utf8")).toBe("export   const c=1\n");
  });

  test("ignores a file the linter does not handle", () => {
    const dir = project({ "notes.txt": "  notes  \n" });
    const { code } = runHook(dir, join(dir, "notes.txt"));
    expect(code).toBe(0);
    expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("  notes  \n");
  });
});
