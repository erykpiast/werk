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
