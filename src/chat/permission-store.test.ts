import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createProject, type Project } from "../test-env/project.ts";
import {
  allowPathBeside,
  appendAsk,
  asksPathBeside,
  keepAllow,
  readAllow,
} from "./permission-store.ts";

let current: Project | undefined;
beforeEach(() => {
  current = createProject();
});
afterEach(async () => {
  await current?.dispose();
});
const logPath = () => (current as Project).logPath;

const record = (tool: string) => ({
  at: "2026-10-25T10:00:00.000Z",
  tool,
  label: tool,
  input: {},
  reason: null,
  decision: "allow" as const,
  widened: [],
});

test("each answered ask adds one line, and no line is rewritten", () => {
  appendAsk(logPath(), record("Bash"));
  appendAsk(logPath(), record("Write"));
  const lines = readFileSync(asksPathBeside(logPath()), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).tool);
  expect(lines).toEqual(["Bash", "Write"]);
});

test("stored updates are read back, and an update stored twice is kept once", () => {
  const update = { type: "addDirectories", directories: ["/x"] };
  expect(readAllow(logPath())).toEqual([]);
  keepAllow(logPath(), [update]);
  keepAllow(logPath(), [update, { type: "setMode" }]);
  expect(readAllow(logPath())).toEqual([update, { type: "setMode" }]);
});

test("a damaged allow file holds no updates", async () => {
  await Bun.write(allowPathBeside(logPath()), "{not json");
  expect(readAllow(logPath())).toEqual([]);
  await Bun.write(allowPathBeside(logPath()), '{"updates": 3}');
  expect(readAllow(logPath())).toEqual([]);
});
