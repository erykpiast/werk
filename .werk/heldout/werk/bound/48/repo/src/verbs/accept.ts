// `werk accept` makes one ghost real, with its ghost parents, options and evidence (#werk-cli-propose,
// #werk-propose-new, #werk-propose-new-carry), or takes the pending change of a real node. On a
// decided card the same accepted event is an amend: a reopen and a decide in one step, so the card
// is never open (#map-frozen). It refuses unless it states that the person asked.
import { registerVerb } from "../cli/registry.ts";
import { formatProblems, stagedLines } from "../map/show.ts";
import { acceptSet } from "../map/stage.ts";
import { logPath, readMap, write } from "../map/store.ts";

registerVerb({
  name: "accept",
  help: "Accept one ghost, with its ghost parents, options and evidence, or a pending change. Only the person accepts.",
  positionals: [{ name: "id", value: "id" }],
  flags: [{ name: "actor", value: "text", help: "you: the person asked for this accept." }],
  run: ({ positionals, flags }, io) => {
    const id = positionals[0] as string;
    if (flags.actor !== "you") {
      io.err(
        "werk accept: refused: an accept is the person's. They click the ✓ on the card in the map.\n" +
          "  If they asked for this accept, pass --actor you.\n",
      );
      return 1;
    }
    const log = logPath();
    const map = readMap("accept", log);
    io.err(formatProblems(map.problems));
    const ids = map.nodes.get(id)?.proposed ? acceptSet(map, id) : [id];
    write(
      map,
      ids.map((each) => ({ type: "change.accepted", actor: "you", payload: { id: each } })),
      log,
    );
    io.out(stagedLines(map, id, ids, "accepted"));
    return 0;
  },
});
