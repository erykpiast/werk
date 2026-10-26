// `werk say` appends one note to the thread of a node id (#werk-cli-notes). Any node takes one,
// a ghost and an excerpt too.
import { registerVerb } from "../cli/registry.ts";
import { formatProblems } from "../map/show.ts";
import { logPath, readMap, write } from "../map/store.ts";

registerVerb({
  name: "say",
  help: "Write one note on the thread of a card. The map shows it on the card.",
  positionals: [
    { name: "id", value: "id" },
    { name: "text", value: "text" },
  ],
  run: ({ positionals }, io) => {
    const [id, text] = positionals as [string, string];
    const log = logPath();
    const map = readMap("say", log);
    io.err(formatProblems(map.problems));
    const [event] = write(map, [{ type: "note.added", actor: "agent", payload: { id, text } }], log);
    io.out(`${id}: note [${event?.seq}] written\n`);
    return 0;
  },
});
