// `werk show` prints one node with its status, who, parent and links (#werk-cli-show).
import { registerVerb } from "../cli/registry.ts";
import { formatNode, formatProblems } from "../map/show.ts";
import { logPath, readMap } from "../map/store.ts";

registerVerb({
  name: "show",
  help: "Print one node: its status, who, parent and links.",
  positionals: [{ name: "id", value: "id" }],
  run: ({ positionals }, io) => {
    const id = positionals[0] as string;
    const log = logPath();
    const map = readMap("show", log);
    io.err(formatProblems(map.problems));
    const text = formatNode(map, id);
    if (text === undefined) {
      io.err(`werk show: no node #${id} in the map\n`);
      return 1;
    }
    io.out(text);
    return 0;
  },
});
