import { describe, expect, test } from "bun:test";
import { instructionsText } from "./instructions.ts";
import {
  buildLaunchOptions,
  type LaunchInput,
  OPUS,
  SONNET,
} from "./launch-options.ts";
import { subagentDefinitions } from "./subagents.ts";

const WERK = '"/bin/werk"';
const base: LaunchInput = {
  role: "builder",
  werk: WERK,
  projectIsWerk: false,
  buildRuleTitles: ["Tests run against a real database"],
};

describe("buildLaunchOptions", () => {
  test("the builder gets its role, Sonnet with the Opus advisor, and the text", () => {
    const o = buildLaunchOptions(base);
    expect(o.env.WERK_AGENT_ROLE).toBe("builder");
    expect(o.model).toBe(SONNET);
    expect(o.advisor).toBe(OPUS);
    expect(o.appendSystemPrompt).toContain(instructionsText(WERK));
    expect(Object.keys(o.agents ?? {}).sort()).toEqual([
      "prototyper",
      "test-scope",
    ]);
  });

  test("the options never replace the agent's own system prompt", () => {
    for (const role of ["builder", "chat", "grader", "sample"]) {
      const o = buildLaunchOptions({ ...base, role });
      expect(Object.keys(o)).not.toContain("systemPrompt");
    }
  });

  test("the text comes after nothing of the agent's own prompt and holds the titles", () => {
    const o = buildLaunchOptions(base);
    expect(o.appendSystemPrompt).toContain("Tests run against a real database");
    expect(o.appendSystemPrompt?.startsWith("# werk")).toBe(true);
  });

  test("no titles section when the project has no build-rule cards", () => {
    const o = buildLaunchOptions({ ...base, buildRuleTitles: [] });
    expect(o.appendSystemPrompt).not.toContain("Build rules of this project");
  });

  test.each([
    ["spec-writer", OPUS, null],
    ["ticket-writer", OPUS, null],
    ["grader", OPUS, null],
    ["reviewer-design", SONNET, null],
    ["heldout-binder", SONNET, null],
    ["heldout-author", SONNET, null],
    ["classifier", SONNET, null],
  ])("role %s runs on its own model", (role, model, advisor) => {
    const o = buildLaunchOptions({ ...base, role });
    expect(o.model).toBe(model);
    expect(o.advisor).toBe(advisor);
  });

  test("a role with no map writes gets no instruction text", () => {
    for (const role of [
      "grader",
      "reviewer-tests",
      "classifier",
      "heldout-binder",
      "sample",
      "diagram-updater",
    ]) {
      const o = buildLaunchOptions({ ...base, role });
      expect(o.appendSystemPrompt).toBeUndefined();
      expect(o.agents).toBeUndefined();
      expect(o.env.WERK_AGENT_ROLE).toBe(role);
    }
  });

  test("the chat keeps its own model setting", () => {
    const chat = { model: "claude-x", advisor: "claude-y" };
    const o = buildLaunchOptions({ ...base, role: "chat", chatModel: chat });
    expect(o.model).toBe("claude-x");
    expect(o.advisor).toBe("claude-y");
    expect(o.appendSystemPrompt).toContain(instructionsText(WERK));
  });

  test("a role outside the table with no chat setting has no model", () => {
    const o = buildLaunchOptions({ ...base, role: "sample" });
    expect(o.model).toBeUndefined();
    expect(o.advisor).toBeNull();
  });

  test("in werk's own checkout the text and subagents are not added twice", () => {
    const o = buildLaunchOptions({ ...base, projectIsWerk: true });
    expect(o.appendSystemPrompt).not.toContain("# werk: the decision map");
    expect(o.appendSystemPrompt).toContain("Tests run against a real database");
    expect(o.agents).toBeUndefined();
    const bare = buildLaunchOptions({
      ...base,
      projectIsWerk: true,
      buildRuleTitles: [],
    });
    expect(bare.appendSystemPrompt).toBeUndefined();
  });
});

describe("instruction text", () => {
  const text = instructionsText(WERK);

  test("cites no card id except a made-up one", () => {
    const ids = new Set(
      [...text.matchAll(/#([a-z][a-z0-9:-]*)/g)].map((m) => m[1]),
    );
    expect(
      [...ids].filter((id) => id !== "checkout-retry" && id !== "id"),
    ).toEqual([]);
  });

  test("names every command by the running werk", () => {
    const commands = [
      ...text.matchAll(
        /`([^`]*\b(?:add|link|status|reopen|show|search|say|inbox|discard|help)\b[^`]*)`/g,
      ),
    ];
    expect(commands.length).toBeGreaterThan(5);
    for (const [, cmd] of commands) {
      if (cmd?.includes("--") || cmd?.includes("<"))
        expect(cmd.startsWith(WERK) || cmd.startsWith("--")).toBe(true);
    }
    expect(text).toContain(`${WERK} add`);
  });

  test("states the wording rules and the operation-name rule", () => {
    expect(text).toContain("No session narration");
    expect(text).toContain("No code names");
    expect(text).toContain("Name a map operation by its plain name");
  });

  test("subagent prompts name werk by the running path", () => {
    const defs = subagentDefinitions(WERK);
    expect(defs.prototyper?.prompt).toContain(`${WERK} prototype`);
    expect(defs["test-scope"]?.prompt).toContain(`${WERK} search`);
    expect(JSON.stringify(defs)).not.toMatch(/#[a-z]+-[a-z-]+/);
  });
});
