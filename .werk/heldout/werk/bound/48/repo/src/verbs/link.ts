// `werk link` and `werk unlink` add or remove one typed link (#werk-cli-link). A link on a ghost
// is held until both of its ends are real (#werk-propose-new).
import { registerVerb } from "../cli/registry.ts";
import { formatProblems } from "../map/show.ts";
import { logPath, readMap, write } from "../map/store.ts";
import { isLive } from "../map/tree.ts";
import type { LinkType } from "../map/types.ts";

const ENDS = [
  { name: "from", value: "id" },
  { name: "to", value: "id" },
] as const;
const TYPE_HELP = "refines, depends_on, supported_by or alternative_to.";

function linkType(
  flags: Record<string, string | true>,
  err: (text: string) => void,
  verb: string,
): LinkType | undefined {
  if (typeof flags.type === "string") return flags.type as LinkType;
  err(`werk ${verb}: needs --type: ${TYPE_HELP}\n`);
  return undefined;
}

registerVerb({
  name: "link",
  help: "Add one typed link from one node to another. A depends_on link needs --why.",
  positionals: [...ENDS],
  flags: [
    { name: "type", value: "text", help: TYPE_HELP },
    { name: "why", value: "text", help: "For depends_on: what <from> takes from <to>." },
  ],
  run: ({ positionals, flags }, io) => {
    const type = linkType(flags, io.err, "link");
    if (type === undefined) return 1;
    const [from, to] = positionals as [string, string];
    const log = logPath();
    const map = readMap("link", log);
    io.err(formatProblems(map.problems));
    const link = typeof flags.why === "string" ? { from, to, type, why: flags.why } : { from, to, type };
    write(map, [{ type: "edge.added", actor: "agent", payload: link }], log);
    const held = isLive(map, link) ? "" : ", held until both ends are accepted";
    io.out(`${from} -> ${to} ${type}: linked${held}\n`);
    return 0;
  },
});

registerVerb({
  name: "unlink",
  help: "Remove one typed link from the map. The log keeps it.",
  positionals: [...ENDS],
  flags: [{ name: "type", value: "text", help: TYPE_HELP }],
  run: ({ positionals, flags }, io) => {
    const type = linkType(flags, io.err, "unlink");
    if (type === undefined) return 1;
    const [from, to] = positionals as [string, string];
    const log = logPath();
    const map = readMap("unlink", log);
    io.err(formatProblems(map.problems));
    write(map, [{ type: "edge.removed", actor: "agent", payload: { from, to, type } }], log);
    io.out(`${from} -> ${to} ${type}: unlinked\n`);
    return 0;
  },
});
