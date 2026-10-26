import { expect, test } from "bun:test";
import { fold } from "../map/fold.ts";
import type { Draft, NodeFields } from "../map/types.ts";
import {
  type AgentRole,
  type AgentSetup,
  agentArgs,
  buildRuleTitles,
  fillWerk,
  INSTRUCTIONS,
  INSTRUCTIONS_INCLUDE,
  includesInstructions,
  parseSubagent,
  SUBAGENT_TEXTS,
  shippedSubagents,
  subagentsFor,
  systemPrompt,
  WERK_PLACEHOLDER,
  werkCommand,
} from "./prompt.ts";

const WERK = "/opt/bun /opt/werk/src/cli.ts";
const BASE = "You are a builder.\n";

const mapOf = (...drafts: Draft[]) =>
  fold(drafts.map((d, i) => JSON.stringify({ seq: i + 1, at: "t", ...d })).join("\n"));
const added = (fields: Partial<NodeFields> & { id: string; parent?: string }): Draft => ({
  type: "node.added",
  actor: "agent",
  payload: { kind: "card", title: `Title of ${fields.id}`, status: "decided", ...fields },
});

const RULES = mapOf(
  added({ id: "root" }),
  added({ id: "how", title: "Build rules" }),
  added({ id: "tests", parent: "how", title: "Tests run against a real database" }),
  added({ id: "tests-fast", parent: "tests", title: "A unit test takes under a second" }),
  added({ id: "words", parent: "how", title: "An order is one checkout" }),
  added({ id: "export", parent: "root", title: "An export holds every order" }),
);
const EMPTY = mapOf(added({ id: "root" }), added({ id: "how" }));

const setup = (role: AgentRole, over: Partial<AgentSetup> = {}): AgentSetup => ({
  role,
  base: BASE,
  werk: WERK,
  map: RULES,
  ...over,
});

const TITLES = [
  "- #tests — Tests run against a real database",
  "  - #tests-fast — A unit test takes under a second",
  "- #words — An order is one checkout",
].join("\n");

test("a build pass's prompt is its own prompt, then the werk text, then the build-rule titles", () => {
  const prompt = systemPrompt(setup("builder"));
  const text = fillWerk(INSTRUCTIONS, WERK).trimEnd();
  expect(prompt.startsWith(`${BASE}\n${text}\n\n## This project's build rules\n`)).toBe(true);
  expect(prompt.endsWith(`${TITLES}\n`)).toBe(true);
  expect(prompt).not.toContain(WERK_PLACEHOLDER);
});

test("the chat agent and the plan writers get the werk text too", () => {
  for (const role of ["chat", "plan-writer"] as const) {
    expect(systemPrompt(setup(role))).toContain(fillWerk(INSTRUCTIONS, WERK).trimEnd());
  }
});

test("a sample agent, a diagram agent and a model call with no tools get only their own prompt", () => {
  for (const role of ["sample", "diagram", "no-tools"] as const) {
    expect(systemPrompt(setup(role))).toBe(BASE);
    expect(agentArgs(setup(role))).toEqual(["--append-system-prompt", BASE]);
    expect(subagentsFor(setup(role))).toBeUndefined();
  }
});

test("in werk's own checkout the text and the subagents are not added a second time", () => {
  const own = setup("builder", { projectInstructions: `# Working on werk\n\n${INSTRUCTIONS_INCLUDE}\n` });
  const prompt = systemPrompt(own);
  expect(prompt).not.toContain("how to work with the decision map");
  expect(prompt).toContain(TITLES);
  expect(subagentsFor(own)).toBeUndefined();
});

test("a project's instruction file that only mentions the include path still gets the text", () => {
  expect(includesInstructions(`See ${INSTRUCTIONS_INCLUDE} in werk.`)).toBe(false);
  expect(includesInstructions(undefined)).toBe(false);
  expect(includesInstructions(`  ${INSTRUCTIONS_INCLUDE}  `)).toBe(true);
});

test("with no cards under the build-rules card, the prompt holds no title list", () => {
  expect(buildRuleTitles(EMPTY, WERK)).toBe("");
  const prompt = systemPrompt(setup("builder", { map: EMPTY }));
  expect(prompt).toBe(`${BASE}\n${fillWerk(INSTRUCTIONS, WERK).trimEnd()}\n`);
  expect(buildRuleTitles(mapOf(added({ id: "root" })), WERK)).toBe("");
});

test("the title list skips ghosts, open cards and options, and keeps a decided card below an open one", () => {
  const map = mapOf(
    added({ id: "how" }),
    added({ id: "draft", parent: "how", status: "open" }),
    added({ id: "kept", parent: "draft", title: "Kept rule" }),
    { type: "node.proposed", actor: "agent", payload: { id: "ghost", kind: "card", title: "Ghost", parent: "how" } },
  );
  expect(buildRuleTitles(map, WERK)).toContain("\n- #kept — Kept rule\n");
  expect(buildRuleTitles(map, WERK)).not.toContain("Ghost");
  expect(buildRuleTitles(map, WERK)).toContain(`\`${WERK} show <id>\``);
});

test("each agent that gets the text gets the shipped subagents, with the werk command line filled in", () => {
  const args = agentArgs(setup("chat"));
  expect(args[0]).toBe("--append-system-prompt");
  expect(args[2]).toBe("--agents");
  const agents = JSON.parse(args[3] as string);
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  expect(agents["test-scope"].tools).toEqual(["Read", "Grep", "Glob", "Bash"]);
  expect(agents.prototyper.prompt).toContain(`${WERK} prototype --fork-file`);
  expect(args[3]).not.toContain(WERK_PLACEHOLDER);
});

test("the instruction text names every subagent that werk ships", () => {
  for (const name of Object.keys(shippedSubagents(WERK))) expect(INSTRUCTIONS).toContain(`\`${name}\``);
});

test("the instruction text and the subagents name no card id but the made-up examples", () => {
  const examples = new Set(["checkout-retry", "order-format", "orders", "x"]);
  for (const text of [INSTRUCTIONS, ...SUBAGENT_TEXTS]) {
    const ids = [...text.matchAll(/(?<![\w/&])#([A-Za-z0-9][\w-]*(?::[\w-]+)*)/g)].map((match) => match[1]);
    expect(ids.filter((id) => !examples.has(id as string))).toEqual([]);
  }
});

test("werk runs from source as the runtime and the entry script, and from a built file as that file", () => {
  expect(werkCommand("/opt/bun", "/opt/werk/src/cli.ts")).toBe(WERK);
  expect(werkCommand("/usr/local/bin/werk", "/$bunfs/root/werk")).toBe("/usr/local/bin/werk");
  expect(werkCommand("/Users/a b/bun", "/it's/cli.ts")).toBe(`'/Users/a b/bun' '/it'\\''s/cli.ts'`);
});

test("a subagent definition needs its front matter, a name and a description", () => {
  expect(() => parseSubagent("no front matter")).toThrow("front matter");
  expect(() => parseSubagent("---\nname: x\n---\nprompt")).toThrow("name and a description");
  expect(parseSubagent("---\nname: x\ndescription: d: e\n---\n\nSay hi.\n")).toEqual([
    "x",
    { description: "d: e", prompt: "Say hi." },
  ]);
});
