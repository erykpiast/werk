/**
 * The check on the repository's Claude Code subagent folder. See
 * #werk-cc-subagents.
 */

/** What the folder holds under one name: nothing, a link, or a plain file. */
export type Entry = "missing" | "link" | "file";

/** One failure line for each shipped subagent whose entry is not a link. */
export function subagentLinkFailures(entries: Record<string, Entry>): string[] {
  return Object.entries(entries).flatMap(([name, entry]) => {
    if (entry === "link") return [];
    return entry === "missing"
      ? [`subagent ${name}: no link in the subagent folder`]
      : [
          `subagent ${name}: the file in the subagent folder is a copy, not a link`,
        ];
  });
}
