// `werk propose` stages a change to a real node's title, why or body as tagged ops (#werk-cli-propose,
// #al-diff-cli). The rules refuse an op list that leaves a block of the body unnamed
// (#al-diff-cli-cover). The words stay as they are until an accept or an amend (#map-frozen).
import { registerVerb } from "../cli/registry.ts";
import { formatPending, formatProblems } from "../map/show.ts";
import { logPath, readMap, write } from "../map/store.ts";
import type { Proposal } from "../map/types.ts";

registerVerb({
  name: "propose",
  help: "Stage a change to a node's title, why or body. The person accepts it in the map.",
  positionals: [{ name: "id", value: "id" }],
  flags: [
    { name: "title", value: "text", help: "The new title." },
    { name: "why", value: "text", help: "The new why." },
    {
      name: "ops",
      value: "text",
      help: 'The body as a JSON list of ops: {"tag":"elaborated","old","new"}, {"tag":"new","new"} or {"tag":"removed","old"}. Every block of the body is the old of one op.',
    },
  ],
  run: ({ positionals, flags }, io) => {
    const id = positionals[0] as string;
    const proposal: Proposal = {};
    if (typeof flags.title === "string") proposal.title = flags.title;
    if (typeof flags.why === "string") proposal.why = flags.why;
    if (typeof flags.ops === "string") {
      try {
        proposal.ops = JSON.parse(flags.ops);
      } catch (error) {
        io.err(`werk propose: --ops is not JSON: ${(error as Error).message}\n`);
        return 1;
      }
    }
    if (Object.keys(proposal).length === 0) {
      io.err("werk propose: needs --title, --why or --ops\n");
      return 1;
    }
    const log = logPath();
    const map = readMap("propose", log);
    io.err(formatProblems(map.problems));
    write(map, [{ type: "change.proposed", actor: "agent", payload: { id, ...proposal } }], log);
    const node = readMap("propose", log).nodes.get(id);
    io.out(`${id}: proposed\n${node === undefined ? "" : `${formatPending(node).join("\n")}\n`}`);
    return 0;
  },
});
