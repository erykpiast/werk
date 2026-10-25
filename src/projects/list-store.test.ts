import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPath, readStored, userHome, writeStored } from "./list-store.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "werk-home-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

test("a list that was written is read back, and no temporary file stays", () => {
  expect(readStored(home)).toEqual([]);
  writeStored(join(home, "nested"), ["/a/one"]);
  expect(readStored(join(home, "nested"))).toEqual(["/a/one"]);
  expect(readdirSync(join(home, "nested"))).toEqual(["projects.json"]);
});

test("a file that is not a list is refused, and the next write is not made over it", () => {
  writeFileSync(listPath(home), "{oops");
  expect(() => readStored(home)).toThrow(/cannot be read/);
});

test("the per-user folder comes from WERK_HOME, then the config folder, then the home folder", () => {
  expect(userHome({ WERK_HOME: "/x" })).toBe("/x");
  expect(userHome({ XDG_CONFIG_HOME: "/c" })).toBe("/c/werk");
  expect(userHome({})).toMatch(/\.config\/werk$/);
});

test("WERK_LOG puts the per-user folder beside the log it names", () => {
  expect(userHome({ WERK_LOG: "/x/log.jsonl" })).toBe("/x/server");
  expect(userHome({ WERK_HOME: "/h", WERK_LOG: "/x/log.jsonl" })).toBe("/h");
});
