import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, type Project } from "../test-env/project.ts";
import { tokenOf } from "./page-html.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");

let project: Project;
let scratch: string;
let opener: string;
beforeEach(() => {
  project = createProject();
  scratch = mkdtempSync(join(tmpdir(), "werk-projects-"));
  opener = join(scratch, "opener.sh");
  writeFileSync(
    opener,
    `#!/bin/sh\necho "$1" >> "${join(scratch, "opened")}"\n`,
  );
  chmodSync(opener, 0o755);
});
afterEach(async () => {
  await project.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

const opened = () =>
  existsSync(join(scratch, "opened"))
    ? readFileSync(join(scratch, "opened"), "utf8").trim().split("\n")
    : [];

async function until<T>(read: () => T | undefined | Promise<T | undefined>) {
  const end = Date.now() + 10000;
  for (;;) {
    const value = await (async () => read())().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(50);
  }
}

/** Starts the one server in the test project and returns its address. */
async function startServer() {
  const child = project.start(["bun", CLI, "serve", "--port", "0"]);
  const port = await until(() => {
    const lock = JSON.parse(
      readFileSync(join(project.home, "serve.lock"), "utf8"),
    );
    return lock.port > 0 ? (lock.port as number) : undefined;
  });
  const origin = `http://127.0.0.1:${port}`;
  const token = tokenOf(await (await fetch(`${origin}/`)).text()) as string;
  const get = async (path: string) => {
    const res = await fetch(`${origin}${path}`);
    return { status: res.status, body: await res.json() };
  };
  const remove = async (name: string, confirm = false) => {
    const res = await fetch(
      `${origin}/api/projects/${encodeURIComponent(name)}${confirm ? "?confirm=1" : ""}`,
      { method: "DELETE", headers: { "x-werk-token": token } },
    );
    return { status: res.status, body: await res.json() };
  };
  const names = async () =>
    ((await get("/api/projects")).body.projects as { name: string }[]).map(
      (p) => p.name,
    );
  return { child, origin, port, token, get, remove, names };
}

/** A start in a folder while the server runs. */
const startIn = (folder: string) =>
  project.run(["bun", CLI, "serve"], { WERK_OPEN: opener }, folder);

const addCard = (folder: string, id: string) =>
  project.run(["bun", CLI, "add", id, "--title", id.toUpperCase()], {}, folder);

const nodes = async (
  server: Awaited<ReturnType<typeof startServer>>,
  name: string,
) =>
  (
    (
      await server.get(
        `/api/projects/${encodeURIComponent(name)}/graph?shape=1`,
      )
    ).body.nodes as { id: string }[]
  ).map((n) => n.id);

test("a second start in another folder adds that project and exits, and both maps open from one server", async () => {
  const server = await startServer();
  const other = project.folder("work", "checkout");
  expect((await addCard(project.dir, "alpha")).code).toBe(0);
  expect((await addCard(other, "beta")).code).toBe(0);

  const second = await startIn(other);
  expect(second.code).toBe(0);
  expect(second.stdout).toContain("added checkout");
  expect(opened()).toEqual([`${server.origin}/p/checkout`]);

  expect(await server.names()).toEqual(["project", "checkout"]);
  expect(await nodes(server, "project")).toEqual(["alpha"]);
  expect(await nodes(server, "checkout")).toEqual(["beta"]);
});

test("a start in a folder with no git repository is refused and the list stays", async () => {
  const server = await startServer();
  const bare = join(scratch, "bare");
  Bun.spawnSync(["mkdir", bare]);
  const result = await startIn(bare);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("git is required");
  expect(await server.names()).toEqual(["project"]);
});

test("removing a project and adding its folder again shows the same map", async () => {
  const server = await startServer();
  const other = project.folder("work", "checkout");
  expect((await addCard(other, "beta")).code).toBe(0);
  expect((await startIn(other)).code).toBe(0);

  expect((await server.remove("checkout")).status).toBe(200);
  expect(await server.names()).toEqual(["project"]);
  expect(existsSync(join(other, ".werk", "log.jsonl"))).toBe(true);
  expect(
    (await server.get("/api/projects/checkout/graph?shape=1")).status,
  ).toBe(404);

  expect((await startIn(other)).code).toBe(0);
  expect(await nodes(server, "checkout")).toEqual(["beta"]);
});

test("a deleted folder shows as missing, does not open, and stays on the list until it is removed", async () => {
  const server = await startServer();
  const other = project.folder("work", "checkout");
  expect((await startIn(other)).code).toBe(0);
  rmSync(other, { recursive: true, force: true });

  const listed = (await server.get("/api/projects")).body.projects as {
    name: string;
    missing: boolean;
  }[];
  expect(listed.map((p) => [p.name, p.missing])).toEqual([
    ["project", false],
    ["checkout", true],
  ]);
  const open = await server.get("/api/projects/checkout/open");
  expect(open.status).toBe(409);
  expect(open.body.error).toBe("missing");
  expect(await server.names()).toEqual(["project", "checkout"]);

  expect((await server.remove("checkout")).status).toBe(200);
  expect(await server.names()).toEqual(["project"]);
});

test("two folders named api get distinct names, and each opens its own map", async () => {
  const server = await startServer();
  const first = project.folder("one", "api");
  const second = project.folder("work", "api");
  expect((await addCard(first, "a1")).code).toBe(0);
  expect((await addCard(second, "a2")).code).toBe(0);
  expect((await startIn(first)).code).toBe(0);
  expect((await startIn(second)).code).toBe(0);

  expect(await server.names()).toEqual(["project", "api", "api (work)"]);
  expect(await nodes(server, "api")).toEqual(["a1"]);
  expect(await nodes(server, "api (work)")).toEqual(["a2"]);
});

test("a removal needs the server token, and a bad name is refused", async () => {
  const server = await startServer();
  const bare = await fetch(`${server.origin}/api/projects/project`, {
    method: "DELETE",
  });
  expect(bare.status).toBe(403);
  expect((await server.remove("nobody")).status).toBe(404);
  expect((await server.get("/api/projects/%E0%A4%A/open")).status).toBe(404);
  expect(await server.names()).toEqual(["project"]);
});

test("the project list survives a restart of the server", async () => {
  const first = await startServer();
  const other = project.folder("work", "checkout");
  expect((await startIn(other)).code).toBe(0);
  first.child.kill("SIGTERM");
  await first.child.exited;

  const second = await startServer();
  expect(await second.names()).toEqual(["project", "checkout"]);
});

test("the folder dialog answers the chosen folder, or that the person cancelled", async () => {
  const dialog = join(scratch, "dialog.sh");
  const answer = join(scratch, "answer");
  writeFileSync(dialog, `#!/bin/sh\ncat "${answer}"\n`);
  chmodSync(dialog, 0o755);
  writeFileSync(answer, `${project.dir}/\n`);
  project.start(["bun", CLI, "serve", "--port", "0"], {
    WERK_FOLDER_DIALOG: dialog,
  });
  const port = await until(() => {
    const lock = JSON.parse(
      readFileSync(join(project.home, "serve.lock"), "utf8"),
    );
    return lock.port > 0 ? (lock.port as number) : undefined;
  });
  const origin = `http://127.0.0.1:${port}`;
  const token = tokenOf(await (await fetch(`${origin}/`)).text()) as string;
  const ask = async () =>
    (
      await fetch(`${origin}/api/projects/dialog`, {
        method: "POST",
        headers: { "x-werk-token": token },
      })
    ).json();

  expect(await ask()).toEqual({ folder: project.dir });
  writeFileSync(answer, "");
  expect(await ask()).toEqual({ cancelled: true });
});
