/**
 * Builds the launch options of any agent werk starts, from its role.
 * See #st-model-per-role, #st-build-seam-role-env and #werk-agent-instructions.
 */
import { ROLE_VAR } from "../fake-agent/run.ts";
import { instructionsText } from "./instructions.ts";
import { type SubagentDefinition, subagentDefinitions } from "./subagents.ts";

export const OPUS = "claude-opus-5-5";
export const SONNET = "claude-sonnet-5-5[1m]";

/** A model and its optional advisor, the pair the chat header selects. */
export type ModelChoice = { model: string; advisor: string | null };

export type LaunchInput = {
  /** The short fixed word for the job, such as builder or grader. */
  role: string;
  /** The model setting of the chat. A role with no model of its own keeps it. */
  chatModel?: ModelChoice;
  /** The running werk: the path that a command is started from. */
  werk: string;
  /** True when the project is werk's own checkout, which already has the text. */
  projectIsWerk: boolean;
  /** The titles of the project's build-rule cards. */
  buildRuleTitles: readonly string[];
};

export type LaunchOptions = {
  /** Variables for the child process. The real agent ignores the role. */
  env: Record<string, string>;
  model: string | undefined;
  advisor: string | null;
  /** Added after the agent's own system prompt. The prompt itself is never replaced. */
  appendSystemPrompt?: string;
  /** Subagent definitions, keyed by name. */
  agents?: Record<string, SubagentDefinition>;
};

const OPUS_ROLES = new Set(["spec-writer", "ticket-writer", "grader"]);
const SONNET_ROLES = new Set([
  "heldout-binder",
  "heldout-author",
  "classifier",
]);
/** The roles that can write the map. */
const MAP_WRITERS = new Set([
  "chat",
  "builder",
  "spec-writer",
  "ticket-writer",
]);

function modelFor(role: string, chat: ModelChoice | undefined): ModelChoice {
  if (OPUS_ROLES.has(role)) return { model: OPUS, advisor: null };
  if (role === "builder") return { model: SONNET, advisor: OPUS };
  // A reviewer's role name carries its quality area, as reviewer-<area>.
  if (SONNET_ROLES.has(role) || role.startsWith("reviewer-"))
    return { model: SONNET, advisor: null };
  return chat ?? { model: "", advisor: null };
}

function titleSection(titles: readonly string[]): string {
  if (titles.length === 0) return "";
  const lines = titles.map((title) => `- ${title}`).join("\n");
  return `\n\n## Build rules of this project\n\nEach line is the title of a build-rule card. Read a card in full when your task touches its rule.\n\n${lines}`;
}

export function buildLaunchOptions(input: LaunchInput): LaunchOptions {
  const { model, advisor } = modelFor(input.role, input.chatModel);
  const options: LaunchOptions = {
    env: { [ROLE_VAR]: input.role },
    model: model === "" ? undefined : model,
    advisor,
  };
  if (!MAP_WRITERS.has(input.role)) return options;
  const titles = titleSection(input.buildRuleTitles);
  if (input.projectIsWerk) {
    // The instruction file of werk's own checkout already holds the text and the subagents.
    if (titles !== "") options.appendSystemPrompt = titles.trimStart();
    return options;
  }
  options.appendSystemPrompt = `${instructionsText(input.werk)}${titles}`;
  options.agents = subagentDefinitions(input.werk);
  return options;
}
