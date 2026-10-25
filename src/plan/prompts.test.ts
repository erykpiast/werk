import { expect, test } from "bun:test";
import { headlessArgs } from "./agent-args.ts";
import { specPrompt, ticketPrompt } from "./prompts.ts";

const paths = {
  spec: "/s/spec.md",
  specAnswers: "/s/spec-answers.json",
  ticketAnswers: "/s/ticket-answers.json",
  ticketsDir: "/t",
};
const scope = { first: ["card A"], second: ["card B"] };

test("the spec prompt keeps the tiers apart, first tier first, and names its two files", () => {
  const text = specPrompt("app", scope, paths);
  expect(text.indexOf("card A")).toBeLessThan(text.indexOf("card B"));
  expect(text).toContain("First tier");
  expect(text).toContain("Second tier");
  expect(text).toContain("/s/spec.md");
  expect(text).toContain("/s/spec-answers.json");
});

test("a scope with no second tier has no second-tier section", () => {
  expect(specPrompt("app", { first: ["A"], second: [] }, paths)).not.toContain(
    "Second tier",
  );
});

test("the ticket prompt gives the fixed format and the folder", () => {
  const text = ticketPrompt("app", scope, paths);
  for (const line of [
    "title:",
    "cites:",
    "blocked_by:",
    "stories:",
    "touches:",
  ])
    expect(text).toContain(line);
  expect(text).toContain("## Acceptance criteria");
  expect(text).toContain("/t");
  expect(text).toContain("/s/ticket-answers.json");
});

test("the headless command line holds the tools, the rules and the launch options", () => {
  const args = headlessArgs({
    options: {
      env: {},
      model: "m",
      advisor: "a",
      appendSystemPrompt: "p",
      agents: {},
    },
    tools: ["Read", "Write"],
    allow: ["Read", "Write(//x)"],
  });
  expect(args).toContain("-p");
  expect(args[args.indexOf("--tools") + 1]).toBe("Read,Write");
  expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read,Write(//x)");
  expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
  expect(args[args.indexOf("--model") + 1]).toBe("m");
  expect(args[args.indexOf("--advisor") + 1]).toBe("a");
  expect(args).toContain("--append-system-prompt");
  expect(args).toContain("--agents");
});

test("a role with no model, advisor or text adds none of those flags", () => {
  const args = headlessArgs({
    options: { env: {}, model: undefined, advisor: null },
    tools: [],
    allow: [],
  });
  for (const flag of [
    "--model",
    "--advisor",
    "--append-system-prompt",
    "--agents",
  ])
    expect(args).not.toContain(flag);
});
