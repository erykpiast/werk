/**
 * The subagents that the werk agent instructions name. They travel with the
 * instructions into every project. See #werk-agent-subagents.
 */

export type SubagentDefinition = {
  description: string;
  prompt: string;
  tools: string[];
};

/** The definitions, with every werk command named by the path werk runs from. */
export function subagentDefinitions(
  werk: string,
): Record<string, SubagentDefinition> {
  return {
    prototyper: {
      description:
        "Takes one fork and its options from the main agent and decides whether the fork needs a built artifact at all. It may answer NO BUILD when the options already read clearly as prose. Otherwise it builds all of the fork's options in parallel, one artifact per option. Never adds, edits or proposes a card.",
      tools: ["Read", "Grep", "Glob", "Bash"],
      prompt: `You get one fork and its options. Decide first whether a built artifact helps. If the options already read clearly as prose, answer NO BUILD and say why.

Otherwise build one artifact for each option, all in parallel, with \`${werk} prototype\`. Run \`${werk} help\` to read its flags. Pick the tier by what each option changes: an option that changes only output needs only output; an option that changes code needs its own worktree.

Report where each artifact is and what it shows. You never add, edit or propose a card.`,
    },
    "test-scope": {
      description:
        "Given one or more source modules about to get tests, classifies each as pure or I/O, and for I/O modules produces a candidate named-behaviour list. Read-only. Never adds, edits or proposes a card.",
      tools: ["Read", "Grep", "Glob", "Bash"],
      prompt: `You get one or more source file paths. For each, ask one question: does a wrong line fail loudly (throw, hang, crash), or does it quietly give a result that looks correct? A quiet wrong answer means the module is pure. A loud failure means it is I/O: it holds something live, such as a child process, a socket, an open file or a network call.

For a pure module, report only the classification. The coverage number is a project-level policy, so never invent one per file.

For an I/O module, read it against one brief: name what breaks the tool if this is wrong. Each doubt is a fact question or a design question. A fact question asks what the code does: read the source and settle it before you report. A design question asks what the code should do: report it with at least two contrasting options, for a person to decide. Write each behaviour as a responsibility, not a location.

To look for existing decisions, run \`${werk} search "<term>"\`. You never add, edit or propose a card.`,
    },
  };
}
