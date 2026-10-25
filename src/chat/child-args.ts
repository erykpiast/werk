/**
 * The command line of the chat agent: the flags of the long-lived stream-json child, then the launch
 * options of the chat role (#werk-chat-stdin, #werk-invoke, #werk-perm-mode, #werk-advisor).
 */
import type { LaunchOptions } from "../agent/launch-options.ts";

/** The tools the chat agent may use with no prompt (#werk-pane, #werk-edits). */
export const ALLOWED_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Grep",
  "Glob",
  "WebSearch",
  "WebFetch",
  "Bash(node:*)",
  "Bash(bun:*)",
  "Bash(curl:*)",
  "Bash(python:*)",
  "Bash(rm -f /tmp/:*)",
];

export function chatArgs(options: LaunchOptions): string[] {
  const args = [
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "auto",
    "--allowedTools",
    ALLOWED_TOOLS.join(","),
  ];
  if (options.model) args.push("--model", options.model);
  if (options.advisor) args.push("--advisor", options.advisor);
  if (options.appendSystemPrompt) {
    args.push("--append-system-prompt", options.appendSystemPrompt);
  }
  if (options.agents) args.push("--agents", JSON.stringify(options.agents));
  return args;
}
