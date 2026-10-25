/** Reads the agent's start line: the command names it accepts (#werk-chat-cmdmenu-source). */

/** The command names of a start line, or null when the event is not a start line. A leading slash is dropped. */
export function commandsOf(event: unknown): string[] | null {
  if (typeof event !== "object" || event === null) return null;
  const line = event as Record<string, unknown>;
  if (line.type !== "system" || line.subtype !== "init") return null;
  if (!Array.isArray(line.slash_commands)) return [];
  return line.slash_commands
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.replace(/^\//, ""))
    .filter((name) => name !== "");
}
