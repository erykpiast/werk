/** The command line of a pipeline agent that runs once and exits (#st-model-per-role, #st-spec-decisions-write-scope). Pure. */
import type { LaunchOptions } from "../agent/launch-options.ts";

export type HeadlessInput = {
  options: LaunchOptions;
  /** The tools the agent has at all. */
  tools: readonly string[];
  /** The tool rules that pass without a person. A call that no rule passes is denied. */
  allow: readonly string[];
};

export function headlessArgs(input: HeadlessInput): string[] {
  const { options } = input;
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    // No person answers in a pipeline run, so a call that no rule passes is denied.
    "--permission-mode",
    "dontAsk",
    "--tools",
    input.tools.join(","),
    "--allowedTools",
    input.allow.join(","),
  ];
  if (options.model) args.push("--model", options.model);
  if (options.advisor) args.push("--advisor", options.advisor);
  if (options.appendSystemPrompt) {
    args.push("--append-system-prompt", options.appendSystemPrompt);
  }
  if (options.agents) args.push("--agents", JSON.stringify(options.agents));
  return args;
}
