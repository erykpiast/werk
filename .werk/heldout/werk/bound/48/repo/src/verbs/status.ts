// `werk status <id> decided` moves a card to decided once the contract check passes
// (#werk-cli-decide). A refusal lists every missing fact with the command that fixes it
// (#werk-contract-all-missing, #werk-contract-fix). On a ghost the check reads its held links, so a
// ghost can be proposed already decided (#werk-propose-new).
import { registerVerb } from "../cli/registry.ts";
import { formatProblems } from "../map/show.ts";
import { logPath, readMap, write } from "../map/store.ts";

registerVerb({
  name: "status",
  help: "Decide a card. The contract check needs who, a basis, an option and a kill criterion.",
  positionals: [
    { name: "id", value: "id" },
    { name: "status", value: "text" },
  ],
  run: ({ positionals }, io) => {
    const [id, status] = positionals as [string, string];
    if (status !== "decided") {
      io.err(`werk status: the status is decided, not ${status}\n`);
      return 1;
    }
    const log = logPath();
    const map = readMap("status", log);
    io.err(formatProblems(map.problems));
    write(map, [{ type: "node.decided", actor: "agent", payload: { id } }], log);
    io.out(`${id}: decided\n`);
    return 0;
  },
});
