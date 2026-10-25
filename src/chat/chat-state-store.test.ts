import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearSessionId,
  readSessionId,
  readSettings,
  type SavedSettings,
  writeSessionId,
  writeSettings,
} from "./chat-state-store.ts";

let dir: string;
let logPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-chat-state-"));
  logPath = join(dir, ".werk", "log.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("a session id is kept until it is cleared", () => {
  expect(readSessionId(logPath)).toBeNull();
  writeSessionId(logPath, "abc");
  expect(readSessionId(logPath)).toBe("abc");
  clearSessionId(logPath);
  expect(readSessionId(logPath)).toBeNull();
});

test("the model, advisor and fill come back as they were saved", () => {
  expect(readSettings(logPath)).toBeNull();
  const saved: SavedSettings = {
    model: "opus",
    advisor: null,
    used: 150_000,
    window: 200_000,
  };
  writeSettings(logPath, saved);
  expect(readSettings(logPath)).toEqual(saved);
});

test("a broken settings file holds none", () => {
  writeSettings(logPath, { model: "opus", advisor: null, used: 1, window: 2 });
  const file = join(dir, ".werk", "chat-model.json");
  writeFileSync(file, "{not json");
  expect(readSettings(logPath)).toBeNull();
  writeFileSync(file, JSON.stringify({ model: "opus", advisor: null }));
  expect(readSettings(logPath)).toBeNull();
  writeFileSync(
    file,
    JSON.stringify({ model: "gpt", advisor: null, used: 1, window: 2 }),
  );
  expect(readSettings(logPath)).toBeNull();
});
