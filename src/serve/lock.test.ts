import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takeLock } from "./lock.ts";

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-lock-"));
  path = join(dir, "serve.lock");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const quick = { waitMs: 150, pollMs: 10 };

test("a start with no lock takes it and records its pid and port", async () => {
  const taken = await takeLock(path, { pid: 11, ...quick });
  expect(taken.ok).toBe(true);
  if (taken.ok) taken.lock.setPort(4211);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    pid: 11,
    port: 4211,
  });
});

test("only one of two starts at the same moment takes the lock", async () => {
  const [a, b] = await Promise.all([
    takeLock(path, { pid: 1, isAlive: () => true, ...quick }),
    takeLock(path, { pid: 2, isAlive: () => true, ...quick }),
  ]);
  expect([a.ok, b.ok].sort()).toEqual([false, true]);
});

test("a live holder is waited on, then refused with its pid and port", async () => {
  writeFileSync(path, JSON.stringify({ pid: 89491, port: 4211 }));
  const waits: (number | null)[] = [];
  const started = Date.now();
  const taken = await takeLock(path, {
    isAlive: () => true,
    onWait: (pid) => waits.push(pid),
    ...quick,
  });
  expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  expect(waits).toEqual([89491]);
  expect(taken.ok).toBe(false);
  if (!taken.ok) {
    expect(taken.holder).toEqual({ pid: 89491, port: 4211 });
    expect(taken.message).toContain("port 4211 (pid 89491)");
    expect(taken.message).toContain("One server per .werk.");
  }
});

test("a holder that lets go during the wait hands the lock over", async () => {
  writeFileSync(path, JSON.stringify({ pid: 5, port: 1 }));
  setTimeout(() => rmSync(path), 50);
  const taken = await takeLock(path, {
    isAlive: () => true,
    waitMs: 2000,
    pollMs: 10,
  });
  expect(taken.ok).toBe(true);
});

test("a lock that names a dead pid is stale and is taken over at once", async () => {
  writeFileSync(path, JSON.stringify({ pid: 5, port: 1 }));
  const started = Date.now();
  const taken = await takeLock(path, {
    pid: 7,
    isAlive: () => false,
    waitMs: 5000,
  });
  expect(taken.ok).toBe(true);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(7);
});

test("a lock that does not parse counts as held during the wait and as stale at its end", async () => {
  writeFileSync(path, "");
  const started = Date.now();
  const taken = await takeLock(path, { pid: 7, ...quick });
  expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  expect(taken.ok).toBe(true);
});

test("a lock that is only half written is read again and honoured when it completes", async () => {
  writeFileSync(path, "");
  setTimeout(
    () => writeFileSync(path, JSON.stringify({ pid: 5, port: 9 })),
    30,
  );
  const taken = await takeLock(path, { isAlive: () => true, ...quick });
  expect(taken.ok).toBe(false);
});

test("a release removes the lock of this server and leaves another server's lock", async () => {
  const taken = await takeLock(path, { pid: 7 });
  if (!taken.ok) throw new Error("not taken");
  writeFileSync(path, JSON.stringify({ pid: 8, port: 1 }));
  taken.lock.release();
  expect(existsSync(path)).toBe(true);
  writeFileSync(path, JSON.stringify({ pid: 7, port: 1 }));
  taken.lock.release();
  expect(existsSync(path)).toBe(false);
});
