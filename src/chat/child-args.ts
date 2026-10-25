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
  resume: string | null = null,
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
  if (resume !== null) args.push("--resume", resume);
  return [...args, ...launchFlags(options)];
}

/** The flags that the launch options of a role set: model, advisor, added prompt and subagents. */
export function launchFlags(options: LaunchOptions): string[] {
  const flags: string[] = [];
  if (options.model) flags.push("--model", options.model);
  if (options.advisor) flags.push("--advisor", options.advisor);
  if (options.appendSystemPrompt) {
    flags.push("--append-system-prompt", options.appendSystemPrompt);
  }
  if (options.agents) flags.push("--agents", JSON.stringify(options.agents));
  return flags;
}
