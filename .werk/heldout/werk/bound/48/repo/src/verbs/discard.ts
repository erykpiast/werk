// `werk discard` drops one ghost, its ghost descendants and its own excerpts, and each ghost
// source that no remaining node cites (#werk-cli-propose, #werk-propose-new-carry), or drops the
// pending change of a real node and leaves its words as they were (#al-diff-cli).
import { registerVerb } from "../cli/registry.ts";
import { formatProblems, stagedLines } from "../map/show.ts";
import { discardSet } from "../map/stage.ts";
import { logPath, readMap, write } from "../map/store.ts";

registerVerb({
  name: "discard",
  help: "Drop one ghost, with its ghost descendants and the evidence that only they cite, or a pending change.",
  positionals: [{ name: "id", value: "id" }],
  run: ({ positionals }, io) => {
    const id = positionals[0] as string;
    const log = logPath();
    const map = readMap("discard", log);
    io.err(formatProblems(map.problems));
    const ids = map.nodes.get(id)?.proposed ? discardSet(map, id) : [id];
    write(
      map,
      ids.map((each) => ({ type: "change.discarded", actor: "agent", payload: { id: each } })),
      log,
    );
    io.out(stagedLines(map, id, ids, "discarded"));
    return 0;
  },
});
