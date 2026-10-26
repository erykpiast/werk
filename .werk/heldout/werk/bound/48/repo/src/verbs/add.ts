// `werk add` proposes a card, an option or a source as a ghost, with its parent in the same
// event (#werk-cli-add, #werk-propose-new, #pr-log-one-event).
import { registerVerb } from "../cli/registry.ts";
import { formatProblems } from "../map/show.ts";
import { logPath, readMap, write } from "../map/store.ts";
import type { NodeFields, NodeKind, Status, Who } from "../map/types.ts";

const ADDABLE = ["card", "option", "source"];
const TEXT_FIELDS = ["why", "body", "why_not", "url", "finding"] as const;

registerVerb({
  name: "add",
  help: "Propose a card, an option or a source as a ghost. The person accepts it in the map.",
  positionals: [{ name: "id", value: "id" }],
  flags: [
    { name: "title", value: "text", help: "The title: one sentence about the node's own rule." },
    { name: "why", value: "text", help: "Why the node holds." },
    { name: "body", value: "text", help: "The details." },
    { name: "parent", value: "id", help: "The card it refines." },
    { name: "kind", value: "text", help: "card (the default), option or source." },
    { name: "status", value: "text", help: "open (the default) or proto." },
    { name: "who", value: "text", help: "Who decides: you, me or prototype." },
    { name: "why_not", value: "text", help: "For an option: why it lost." },
    { name: "url", value: "text", help: "For a source: where it is." },
    { name: "finding", value: "text", help: "For a source: what it found." },
  ],
  run: ({ positionals, flags }, io) => {
    const kind = (flags.kind ?? "card") as NodeKind;
    if (!ADDABLE.includes(kind)) {
      io.err(`werk add: --kind is card, option or source. An excerpt comes only from a quote.\n`);
      return 1;
    }
    // A ghost still reaches decided before its accept, through the status operation and its
    // contract check, never through add (#werk-cli-add, #werk-contract-when, #werk-propose-new).
    if (flags.status === "decided") {
      io.err("werk add: refused: a card reaches decided only through werk status, not through add\n");
      return 1;
    }
    if (typeof flags.title !== "string") {
      io.err("werk add: needs --title\n");
      return 1;
    }
    const fields: NodeFields & { parent?: string } = { id: positionals[0] as string, kind, title: flags.title };
    for (const key of TEXT_FIELDS) if (typeof flags[key] === "string") fields[key] = flags[key];
    if (typeof flags.status === "string") fields.status = flags.status as Status;
    if (typeof flags.who === "string") fields.who = flags.who as Who;
    if (typeof flags.parent === "string") fields.parent = flags.parent;
    const log = logPath();
    const map = readMap("add", log);
    io.err(formatProblems(map.problems));
    write(map, [{ type: "node.proposed", actor: "agent", payload: fields }], log);
    io.out(`${fields.id}: proposed\n`);
    return 0;
  },
});
