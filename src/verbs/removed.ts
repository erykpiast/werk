// `removed` lists the removals that are not undone, each with the cards that went with it (#werk-remove).
import { parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { logPathFor, readMap } from "../map/log-store.ts";

registerVerb({
  name: "removed",
  summary: "List the removals that are not undone, with the cards they took",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: [] });
    if (!parsed.ok || parsed.positional.length > 0) {
      err(
        `werk: ${parsed.ok ? "removed takes no id" : parsed.error}\nusage: removed`,
      );
      return 2;
    }
    const { map } = readMap(logPathFor(cwd, env));
    if (map.removals.length === 0) {
      out("nothing is removed");
      return 0;
    }
    const lines = map.removals.map((removal) => {
      const others = removal.nodes
        .filter((node) => node.id !== removal.id)
        .map((node) => node.id);
      return others.length === 0
        ? removal.id
        : `${removal.id} (with ${others.join(", ")})`;
    });
    out(lines.join("\n"));
    return 0;
  },
});
