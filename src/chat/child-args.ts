/**
 * The command line of the chat agent: the flags of the long-lived stream-json child, then the launch
 * options of the chat role (#werk-chat-stdin, #werk-invoke, #werk-perm-mode, #werk-perm-native, #werk-advisor).
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

/** The updates that Always allow stored, as the flags of the next child (#werk-perm-native). */
export type StoredAllow = { tools: string[]; dirs: string[] };

export function chatArgs(
  options: LaunchOptions,
  stored: StoredAllow = { tools: [], dirs: [] },
): string[] {
  const args = [
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "auto",
    "--permission-prompt-tool",
    "stdio",
    "--allowedTools",
    [...ALLOWED_TOOLS, ...stored.tools].join(","),
  ];
  for (const dir of stored.dirs) args.push("--add-dir", dir);
  if (options.model) args.push("--model", options.model);
  if (options.advisor) args.push("--advisor", options.advisor);
  if (options.appendSystemPrompt) {
    args.push("--append-system-prompt", options.appendSystemPrompt);
  }
  if (options.agents) args.push("--agents", JSON.stringify(options.agents));
  return args;
}
