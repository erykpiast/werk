import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);

test("the target verb prints the path it set, and prints it again with no argument", async () => {
  const folder = project.folder("repo");
  const set = await werk("target", folder);
  expect(set.code).toBe(0);
  expect(set.stdout.trim()).toBe(folder);
  expect((await werk("target")).stdout.trim()).toBe(folder);
});

test("with no target set, the verb says how to set one and exits 1", async () => {
  const result = await werk("target");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("werk target <path>");
});

test("a path inside werk's store is refused", async () => {
  mkdirSync(join(project.dir, ".werk", "inner"), { recursive: true });
  const result = await werk("target", join(project.dir, ".werk", "inner"));
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("inside werk's store");
});

test("the repository that holds werk's store is refused", async () => {
  const result = await werk("target", project.dir);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("holds werk's store");
});

test("a file, a missing path and a folder inside a repository are refused", async () => {
  const folder = project.folder("repo");
  mkdirSync(join(folder, "sub"));
  expect((await werk("target", join(folder, "missing"))).stderr).toContain(
    "not a directory",
  );
  expect((await werk("target", join(folder, "sub"))).stderr).toContain(
    "top folder",
  );
  expect((await werk("target", project.home)).code).toBe(1);
});

test("a repository with no branch named main or master has no main line", async () => {
  const folder = project.folder("repo");
  Bun.spawnSync(["git", "symbolic-ref", "HEAD", "refs/heads/trunk"], {
    cwd: folder,
  });
  Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    ],
    { cwd: folder },
  );
  const result = await werk("target", folder);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("no main line");
});
