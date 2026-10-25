import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEntries } from "./check-subagent-links";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true });
});

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "werk-links-"));
  dirs.push(root);
  await mkdir(join(root, ".claude/agents"), { recursive: true });
  await mkdir(join(root, "src/agent/subagents"), { recursive: true });
  return root;
}

test("a link to the shipped file reads as a link", async () => {
  const root = await repo();
  await symlink(
    "../../src/agent/subagents/prototyper.md",
    join(root, ".claude/agents/prototyper.md"),
  );
  expect((await readEntries(root)).prototyper).toBe("link");
});

test("a copy in place of the link reads as a file", async () => {
  const root = await repo();
  await writeFile(join(root, ".claude/agents/prototyper.md"), "copy");
  expect((await readEntries(root)).prototyper).toBe("file");
});

test("a link to another file is not the shipped definition", async () => {
  const root = await repo();
  await symlink("elsewhere.md", join(root, ".claude/agents/prototyper.md"));
  expect((await readEntries(root)).prototyper).toBe("file");
});

test("no entry reads as missing", async () => {
  expect((await readEntries(await repo()))["test-scope"]).toBe("missing");
});

test("the real repository links every shipped subagent", async () => {
  const entries = await readEntries(join(import.meta.dir, "../.."));
  expect(Object.values(entries).every((entry) => entry === "link")).toBe(true);
});

test("the repository defines no skills and no MCP servers", async () => {
  const root = join(import.meta.dir, "../..");
  expect(await Bun.file(join(root, ".mcp.json")).exists()).toBe(false);
  expect(
    await stat(join(root, ".claude/skills")).catch(() => undefined),
  ).toBeUndefined();
  const settings = await Bun.file(join(root, ".claude/settings.json")).json();
  expect(settings.mcpServers).toBeUndefined();
});
