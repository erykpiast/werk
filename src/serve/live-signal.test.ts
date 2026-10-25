import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dirname, "..", "cli.ts");

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(async () => {
  await project.dispose();
});

async function port(): Promise<number> {
  const end = Date.now() + 10000;
  for (;;) {
    try {
      const lock = JSON.parse(
        readFileSync(join(project.dir, ".werk", "serve.lock"), "utf8"),
      );
      if (lock.port > 0) return lock.port;
    } catch {
      // The server has not written its lock yet.
    }
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(50);
  }
}

/** Reads the live channel until the text holds the wanted piece, or the time runs out. */
async function until(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  wanted: string,
) {
  const decoder = new TextDecoder();
  let seen = "";
  const end = Date.now() + 5000;
  while (!seen.includes(wanted) && Date.now() < end) {
    const next = await Promise.race([
      reader.read(),
      Bun.sleep(200).then(() => null),
    ]);
    if (next && !next.done) seen += decoder.decode(next.value);
  }
  return seen;
}

test("a log write sends a bare changed signal to an open page, and another write sends another", async () => {
  project.start(["bun", CLI, "serve", "--port", "0"]);
  const p = await port();
  const res = await fetch(`http://127.0.0.1:${p}/api/live`);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  await until(reader, ": live");

  expect(
    (await project.run(["bun", CLI, "add", "a", "--title", "A"])).code,
  ).toBe(0);
  expect(await until(reader, "event: changed")).toContain(
    "event: changed\ndata:\n\n",
  );

  expect(
    (await project.run(["bun", CLI, "add", "b", "--title", "B"])).code,
  ).toBe(0);
  expect(await until(reader, "event: changed")).toContain("event: changed");
  await reader.cancel();
});

test("a read of the map sends no signal", async () => {
  project.start(["bun", CLI, "serve", "--port", "0"]);
  const p = await port();
  const reader = (
    (await fetch(`http://127.0.0.1:${p}/api/live`))
      .body as ReadableStream<Uint8Array>
  ).getReader();
  await until(reader, ": live");
  await fetch(`http://127.0.0.1:${p}/api/graph?shape=1`);
  expect(await until(reader, "event:")).not.toContain("event:");
  await reader.cancel();
});
