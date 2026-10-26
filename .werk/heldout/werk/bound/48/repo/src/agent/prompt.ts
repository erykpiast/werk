// The system prompt of each agent that werk starts. An agent that can write to the map gets the
// werk agent instructions and the subagents they name (#werk-agent-instructions,
// #werk-agent-subagents), added after its own prompt (#werk-agent-instructions-append), and the
// titles of the build-rule cards (#st-build-howto-titles, #st-build-howto-titles-sample).

import { childrenOf } from "../map/tree.ts";
import type { FoldedMap } from "../map/types.ts";
import instructions from "./instructions.md" with { type: "text" };
import prototyper from "./subagents/prototyper.md" with { type: "text" };
import testScope from "./subagents/test-scope.md" with { type: "text" };

/** Each kind of agent that werk starts. `no-tools` is a model call that cannot act on anything. */
export type AgentRole = "chat" | "builder" | "plan-writer" | "sample" | "diagram" | "no-tools";

/**
 * The agents that can write to the map, and the only ones that get the werk text and the
 * build-rule titles. A sample agent and the diagram agents have narrow contracts that the text
 * would contradict, and a model call with no tools cannot act on it.
 */
export const MAP_WRITERS: readonly AgentRole[] = ["chat", "builder", "plan-writer"];

/** The words in the shipped texts that stand for the werk command line. */
export const WERK_PLACEHOLDER = "{{werk}}";

/** The line by which an instruction file includes the shipped text, as werk's own AGENTS.md does. */
export const INSTRUCTIONS_INCLUDE = "@src/agent/instructions.md";

/** The fixed id of the top card that holds a project's build rules (#st-build-howto-titles). */
export const BUILD_RULES_CARD = "how";

/** The shipped texts as written, before the werk command line is filled in. */
export const INSTRUCTIONS: string = instructions;
export const SUBAGENT_TEXTS: readonly string[] = [prototyper, testScope];

/** A subagent in the shape that Claude Code reads from its agents flag. */
export type Subagent = { description: string; prompt: string; tools?: string[] };

/** What werk knows about one agent when it starts it. */
export type AgentSetup = {
  role: AgentRole;
  /** The agent's own role prompt. The werk text goes after it and replaces nothing. */
  base: string;
  /** The werk command line, as `werkCommand` gives it. */
  werk: string;
  map: FoldedMap;
  /** The project's own instruction file, when it has one. */
  projectInstructions?: string;
};

function quote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * The command line that runs werk from where it runs now: the executable alone when werk is one
 * built file, or the runtime and the entry script when it runs from source.
 */
export function werkCommand(execPath: string, main: string): string {
  return main.endsWith(".ts") ? `${quote(execPath)} ${quote(main)}` : quote(execPath);
}

export function fillWerk(text: string, werk: string): string {
  return text.replaceAll(WERK_PLACEHOLDER, werk);
}

/** True when the project's instruction file already includes the shipped text: werk's own checkout. */
export function includesInstructions(projectInstructions: string | undefined): boolean {
  return (projectInstructions ?? "").split("\n").some((line) => line.trim() === INSTRUCTIONS_INCLUDE);
}

function ruleLines(map: FoldedMap, id: string, depth: number): string[] {
  return childrenOf(map, id).flatMap((child) => {
    const node = map.nodes.get(child);
    const isRule = node?.kind === "card" && !node.proposed && node.status === "decided";
    if (!isRule) return ruleLines(map, child, depth);
    return [`${"  ".repeat(depth)}- #${child} — ${node.title}`, ...ruleLines(map, child, depth + 1)];
  });
}

/** The section that lists the decided cards under the build-rules card, or "" when it has none. */
export function buildRuleTitles(map: FoldedMap, werk: string): string {
  const lines = ruleLines(map, BUILD_RULES_CARD, 0);
  if (lines.length === 0) return "";
  return [
    "## This project's build rules",
    "",
    `Each line is the title of a decided card under the build-rules card #${BUILD_RULES_CARD} in this project's map.`,
    `Follow every one. When your task touches a rule, read its card in full with \`${werk} show <id>\` before you act on it.`,
    "",
    ...lines,
    "",
  ].join("\n");
}

/** One subagent definition: a front matter of `key: value` lines, then the prompt. */
export function parseSubagent(text: string): [string, Subagent] {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (match === null) throw new Error("a subagent definition starts with a front matter between --- lines");
  const fields = new Map(
    (match[1] as string).split("\n").map((line) => {
      const at = line.indexOf(":");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()] as const;
    }),
  );
  const name = fields.get("name");
  const description = fields.get("description");
  if (!name || !description) throw new Error("a subagent definition needs a name and a description");
  const tools = fields.get("tools");
  const subagent: Subagent = { description, prompt: (match[2] as string).trim() };
  if (tools) subagent.tools = tools.split(",").map((tool) => tool.trim());
  return [name, subagent];
}

/** The shipped subagents by name, with the werk command line filled in. */
export function shippedSubagents(werk: string): Record<string, Subagent> {
  return Object.fromEntries(SUBAGENT_TEXTS.map((text) => parseSubagent(fillWerk(text, werk))));
}

/** True when this agent gets the werk text and its subagents from werk itself. */
function addsWerkText(setup: AgentSetup): boolean {
  return MAP_WRITERS.includes(setup.role) && !includesInstructions(setup.projectInstructions);
}

/** The agent's whole system prompt: its own prompt, then the werk text, then the build-rule titles. */
export function systemPrompt(setup: AgentSetup): string {
  const parts = [setup.base.trimEnd()];
  if (addsWerkText(setup)) parts.push(fillWerk(INSTRUCTIONS, setup.werk).trimEnd());
  if (MAP_WRITERS.includes(setup.role)) parts.push(buildRuleTitles(setup.map, setup.werk).trimEnd());
  return `${parts.filter((part) => part !== "").join("\n\n")}\n`;
}

/** The subagents that the agent gets beside the werk text, or undefined when it gets none. */
export function subagentsFor(setup: AgentSetup): Record<string, Subagent> | undefined {
  return addsWerkText(setup) ? shippedSubagents(setup.werk) : undefined;
}

/**
 * The Claude Code arguments that carry the prompt and the subagents. The prompt is appended to
 * Claude Code's own system prompt, which keeps the rules for its tools.
 */
export function agentArgs(setup: AgentSetup): string[] {
  const args = ["--append-system-prompt", systemPrompt(setup)];
  const subagents = subagentsFor(setup);
  if (subagents !== undefined) args.push("--agents", JSON.stringify(subagents));
  return args;
}
