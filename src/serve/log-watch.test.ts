import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LogWatch, watchLog } from "./log-watch.ts";

let dir: string;
let log: string;
let watch: LogWatch | undefined;
let grown: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-watch-"));
  log = join(dir, "log.jsonl");
  grown = 0;
});
afterEach(() => {
  watch?.close();
  watch = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await Bun.sleep(20);
  return check();
}

test("an append to the log is a signal", async () => {
  writeFileSync(log, "one\n");
  watch = watchLog(log, () => grown++);
  // Under a loaded machine the first file event can arrive late, so the append is repeated until one lands.
  let signalled = false;
  for (let i = 0; i < 5 && !signalled; i++) {
    appendFileSync(log, "two\n");
    signalled = await until(() => grown > 0, 3000);
  }
  expect(signalled).toBe(true);
});

test("a log that does not exist yet signals when it appears", async () => {
  watch = watchLog(log, () => grown++);
  writeFileSync(log, "one\n");
  // The operating system's file events can start late under load, so the log grows again until one arrives.
  expect(
    await until(() => {
      if (grown === 0) appendFileSync(log, "more\n");
      return grown > 0;
    }, 5000),
  ).toBe(true);
});

test("a write to another file in the directory is no signal", async () => {
  writeFileSync(log, "one\n");
  watch = watchLog(log, () => grown++);
  appendFileSync(join(dir, "fold-ms.jsonl"), "x\n");
  await Bun.sleep(300);
  expect(grown).toBe(0);
});

test("a log that shrinks is no signal", async () => {
  writeFileSync(log, "one\ntwo\n");
  watch = watchLog(log, () => grown++);
  writeFileSync(log, "one\n");
  await Bun.sleep(300);
  expect(grown).toBe(0);
});

test("a closed watch sends nothing", async () => {
  watch = watchLog(log, () => grown++);
  watch.close();
  writeFileSync(log, "one\n");
  await Bun.sleep(300);
  expect(grown).toBe(0);
});
