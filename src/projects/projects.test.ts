import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStored } from "./list-store.ts";
import {
  addProject,
  closeAll,
  createProjects,
  ensureContext,
  entries,
  type Projects,
  removeProject,
} from "./projects.ts";

let root: string;
let projects: Projects;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "werk-registry-")));
  projects = createProjects(join(root, "home"));
});
afterEach(() => {
  closeAll(projects);
  rmSync(root, { recursive: true, force: true });
});

function repo(...path: string[]): string {
  const folder = join(root, ...path);
  mkdirSync(join(folder, ".git"), { recursive: true });
  return folder;
}

test("a folder with a git repository is added once, under its folder name, with an empty map", async () => {
  const folder = repo("work", "api");
  const added = await addProject(projects, folder);
  expect(added).toMatchObject({ ok: true, name: "api", folder });
  expect(await addProject(projects, folder)).toMatchObject({
    ok: true,
    name: "api",
  });
  expect(readStored(projects.home)).toEqual([folder]);
  expect(existsSync(join(folder, ".werk", "log.jsonl"))).toBe(false);
});

test("a folder reached through a link is stored under its real path", async () => {
  const folder = repo("real");
  Bun.spawnSync(["ln", "-s", folder, join(root, "link")]);
  const added = await addProject(projects, join(root, "link"));
  expect(added).toMatchObject({ ok: true, folder });
});

test("a folder with no git repository is refused, and started as one only on request", async () => {
  const folder = join(root, "bare");
  mkdirSync(folder);
  const refused = await addProject(projects, folder);
  expect(refused).toMatchObject({ ok: false, error: "git-required" });
  expect(readStored(projects.home)).toEqual([]);

  const started = await addProject(projects, folder, { init: true });
  expect(started).toMatchObject({ ok: true, name: "bare" });
  expect(existsSync(join(folder, ".git"))).toBe(true);
});

test("a path that is not a folder is refused", async () => {
  expect(await addProject(projects, join(root, "nothing"))).toMatchObject({
    ok: false,
    status: 400,
    error: "not-a-folder",
  });
});

test("two folders named api get distinct names", async () => {
  await addProject(projects, repo("one", "api"));
  await addProject(projects, repo("work", "api"));
  expect(entries(projects).map((e) => e.name)).toEqual(["api", "api (work)"]);
});

test("a folder that another server holds is listed, and shows as locked until it is free", async () => {
  const folder = repo("held");
  const other = createProjects(join(root, "other-home"));
  await addProject(other, folder);
  const added = await addProject(projects, folder);
  expect(added).toMatchObject({ ok: true });
  expect((added as { locked?: string }).locked).toContain("another werk");
  expect(entries(projects)[0]).toMatchObject({ locked: true, missing: false });

  closeAll(other);
  expect((await ensureContext(projects, folder)).ok).toBe(true);
  expect(entries(projects)[0]?.locked).toBe(false);
});

test("a removal keeps the folder and the map, and a new add finds the same map", async () => {
  const folder = repo("api");
  await addProject(projects, folder);
  await Bun.write(join(folder, ".werk", "log.jsonl"), '{"kept":true}\n');
  expect(await removeProject(projects, "api")).toEqual({ ok: true });
  expect(entries(projects)).toEqual([]);
  expect(existsSync(join(folder, ".werk", "log.jsonl"))).toBe(true);
  expect(existsSync(join(folder, ".werk", "serve.lock"))).toBe(false);
  expect(await addProject(projects, folder)).toMatchObject({
    ok: true,
    name: "api",
  });
});

test("a removal of an unknown name is refused", async () => {
  expect(await removeProject(projects, "nobody")).toMatchObject({
    ok: false,
    status: 404,
  });
});

test("a project with a running agent turn is removed only after a confirmation, and the removal stops the turn", async () => {
  const folder = repo("api");
  await addProject(projects, folder);
  const context = projects.contexts.get(folder);
  let stopped = 0;
  if (!context) throw new Error("no context");
  context.runningTurns = () => ["t1", "t2"];
  context.stopTurns = async () => void stopped++;

  expect(entries(projects)[0]?.running).toEqual(["t1", "t2"]);
  expect(await removeProject(projects, "api")).toEqual({
    ok: false,
    status: 409,
    error: "running",
    running: ["t1", "t2"],
  });
  expect(stopped).toBe(0);
  expect(entries(projects)).toHaveLength(1);

  expect(await removeProject(projects, "api", { confirm: true })).toEqual({
    ok: true,
  });
  expect(stopped).toBe(1);
  expect(entries(projects)).toEqual([]);
});

test("a folder that is deleted shows as missing, does not open, and stays stored", async () => {
  const folder = repo("api");
  await addProject(projects, folder);
  rmSync(folder, { recursive: true, force: true });
  expect(entries(projects)[0]).toMatchObject({ missing: true });
  expect(await ensureContext(projects, folder)).toMatchObject({
    ok: false,
    error: "missing",
  });
  expect(projects.contexts.size).toBe(0);
  expect(readStored(projects.home)).toEqual([folder]);

  // The folder comes back at the same path and opens again.
  repo("api");
  expect((await ensureContext(projects, folder)).ok).toBe(true);
});

test("in dev mode the checkout is listed first, is not stored, and cannot be removed", async () => {
  const checkout = repo("werk");
  const dev = createProjects(join(root, "dev-home"), checkout);
  await addProject(dev, repo("api"));
  expect(readStored(dev.home)).toEqual([join(root, "api")]);
  expect(entries(dev).map((e) => [e.name, e.dev])).toEqual([
    ["werk", true],
    ["api", false],
  ]);
  expect(await removeProject(dev, "werk")).toMatchObject({
    ok: false,
    status: 403,
    error: "dev",
  });

  // A start outside dev mode has no such entry.
  expect(entries(createProjects(dev.home)).map((e) => e.name)).toEqual(["api"]);
  closeAll(dev);
});

test("a checkout that is also stored stays one entry and cannot be removed", async () => {
  const checkout = repo("werk");
  const dev = createProjects(join(root, "dev-home"), checkout);
  await addProject(dev, checkout);
  expect(entries(dev)).toHaveLength(1);
  expect((await removeProject(dev, "werk")).ok).toBe(false);
  closeAll(dev);
});
