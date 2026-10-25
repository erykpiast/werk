import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sourceFile } from "./lint-hook";

const root = join(import.meta.dir, "../..");
const input = (path: string) =>
  JSON.stringify({ tool_input: { file_path: path } });

test("a source file path is picked from the hook input", () => {
  expect(sourceFile(input("/a/b.tsx"))).toBe("/a/b.tsx");
});

test("a file that is not source, or bad input, is skipped", () => {
  expect(sourceFile(input("/a/notes.md"))).toBeUndefined();
  expect(sourceFile("not json")).toBeUndefined();
  expect(sourceFile("{}")).toBeUndefined();
});

async function runHook(path: string) {
  const run = Bun.spawn(["bun", "src/claude/lint-hook.ts"], {
    cwd: root,
    stdin: new Response(input(path)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [err, code] = await Promise.all([
    new Response(run.stderr).text(),
    run.exited,
  ]);
  return { err, code };
}

test("the hook removes an unused import and returns nothing", async () => {
  const dir = await mkdtemp(join(root, ".hook-test-"));
  try {
    const file = join(dir, "a.ts");
    await writeFile(file, 'import { x } from "./x";\nexport const y = 1;\n');
    const { err, code } = await runHook(file);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(await readFile(file, "utf8")).toBe("export const y = 1;\n");
  } finally {
    await rm(dir, { recursive: true });
  }
}, 30000);

test("the hook returns an error it cannot fix, with exit 2", async () => {
  const dir = await mkdtemp(join(root, ".hook-test-"));
  try {
    const file = join(dir, "a.ts");
    await writeFile(file, "export const y = 1;\ndebugger;\n");
    const { err, code } = await runHook(file);
    expect(code).toBe(2);
    expect(err).toContain("debugger");
  } finally {
    await rm(dir, { recursive: true });
  }
}, 30000);
