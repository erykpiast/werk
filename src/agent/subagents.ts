/**
 * The subagents that the werk agent instructions name. They travel with the
 * instructions into every project. See #werk-agent-subagents.
 *
 * Each definition is one markdown file beside this one. The repository's
 * Claude Code subagent folder links to these files. See #werk-cc-subagents.
 */
import prototyper from "./subagents/prototyper.md" with { type: "text" };
import testScope from "./subagents/test-scope.md" with { type: "text" };

export type SubagentDefinition = {
  description: string;
  prompt: string;
  tools: string[];
};

/** The shipped subagents by name. The file under each name is the one definition. */
export const SHIPPED_SUBAGENTS: Record<string, string> = {
  prototyper,
  "test-scope": testScope,
};

/** Splits a definition file into its header fields and its prompt. */
export function parseDefinition(
  file: string,
  werk: string,
): SubagentDefinition {
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]*?)\n*$/.exec(file);
  if (!match) throw new Error("A subagent definition needs a header.");
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? "").split("\n")) {
    const colon = line.indexOf(":");
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return {
    description: fields.get("description") ?? "",
    tools: (fields.get("tools") ?? "").split(",").map((tool) => tool.trim()),
    prompt: (match[2] ?? "").replaceAll("`werk ", `\`${werk} `),
  };
}

/** The definitions, with every werk command named by the path werk runs from. */
export function subagentDefinitions(
  werk: string,
): Record<string, SubagentDefinition> {
  return Object.fromEntries(
    Object.entries(SHIPPED_SUBAGENTS).map(([name, file]) => [
      name,
      parseDefinition(file, werk),
    ]),
  );
}
