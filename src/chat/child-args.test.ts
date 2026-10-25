import { expect, test } from "bun:test";
import { chatArgs } from "./child-args.ts";

test("the child runs stream-json in the auto mode with the default tools", () => {
  const args = chatArgs({ env: {}, model: undefined, advisor: null });
  expect(args).toContain("--include-partial-messages");
  expect(args.slice(args.indexOf("--permission-mode"))[1]).toBe("auto");
  expect(args[args.indexOf("--allowedTools") + 1]).toContain("Bash(bun:*)");
  expect(args).not.toContain("--model");
});

test("the launch options of the role become flags", () => {
  const args = chatArgs({
    env: {},
    model: "m",
    advisor: "a",
    appendSystemPrompt: "rules",
    agents: { x: { description: "d", prompt: "p", tools: [] } },
  });
  expect(args).toEqual(
    expect.arrayContaining([
      "--model",
      "m",
      "--advisor",
      "a",
      "--append-system-prompt",
      "rules",
    ]),
  );
  expect(
    JSON.parse(args[args.indexOf("--agents") + 1] as string).x.prompt,
  ).toBe("p");
});

test("the child asks about unresolved calls on the same pipe", () => {
  const args = chatArgs({ env: {}, model: undefined, advisor: null });
  expect(args.slice(args.indexOf("--permission-prompt-tool"))[1]).toBe("stdio");
  expect(args).not.toContain("--add-dir");
});

test("stored Always-allow rules and directories start the next child", () => {
  const args = chatArgs(
    { env: {}, model: undefined, advisor: null },
    { tools: ["Bash(mkdir:*)"], dirs: ["/tmp/a", "/tmp/b"] },
  );
  expect(args[args.indexOf("--allowedTools") + 1]).toEndWith(",Bash(mkdir:*)");
  expect(args.filter((_a, i) => args[i - 1] === "--add-dir")).toEqual([
    "/tmp/a",
    "/tmp/b",
  ]);
});
