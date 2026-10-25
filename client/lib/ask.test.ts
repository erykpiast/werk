import { expect, test } from "bun:test";
import { callText, letter } from "./ask";

test("a command shows as it is and any other call as JSON", () => {
  expect(callText({ tool: "Bash", input: { command: "ls -la" } })).toBe(
    "ls -la",
  );
  expect(callText({ tool: "Write", input: { file_path: "/x" } })).toBe(
    '{\n  "file_path": "/x"\n}',
  );
  expect(callText({ tool: "Odd", input: null })).toBe("null");
});

test("options are lettered from A", () => {
  expect([0, 1, 2].map(letter)).toEqual(["A", "B", "C"]);
});
