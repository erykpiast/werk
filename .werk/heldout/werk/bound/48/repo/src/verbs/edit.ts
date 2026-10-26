// `werk edit` sets who decides a card, or records a basis or an option waiver with its reason
// (#werk-cli-edit, #werk-contract-waiver-reason). Each is a record on the card, not its words, so
// it applies to a ghost and to a decided card too, unless it removes a fact a decided card has
// (#werk-contract-amend-scope).
import { registerVerb } from "../cli/registry.ts";
import { formatProblems } from "../map/show.ts";
import { logPath, readMap, write } from "../map/store.ts";
import type { CardRecords, Who } from "../map/types.ts";

registerVerb({
  name: "edit",
  help: "Set who decides a card, or waive its basis or its option with a written reason.",
  positionals: [{ name: "id", value: "id" }],
  flags: [
    { name: "who", value: "text", help: "Who decides: you, me or prototype." },
    { name: "no-basis", value: "text", help: "Why no decided card is a basis of this card." },
    { name: "unchallenged", value: "text", help: "Why no option was weighed against this card." },
  ],
  run: ({ positionals, flags }, io) => {
    const id = positionals[0] as string;
    const records: CardRecords = {};
    if (typeof flags.who === "string") records.who = flags.who as Who;
    if (typeof flags["no-basis"] === "string") records.no_basis = flags["no-basis"];
    if (typeof flags.unchallenged === "string") records.unchallenged = flags.unchallenged;
    if (Object.keys(records).length === 0) {
      io.err("werk edit: needs --who, --no-basis or --unchallenged\n");
      return 1;
    }
    const log = logPath();
    const map = readMap("edit", log);
    io.err(formatProblems(map.problems));
    write(map, [{ type: "node.edited", actor: "agent", payload: { id, ...records } }], log);
    io.out(`${id}: edited\n`);
    return 0;
  },
});
