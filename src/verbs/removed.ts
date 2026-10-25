// `removed` prints every removal that is not undone (#werk-remove).
import { registerVerb } from "../cli/registry.ts";
import { logPathFor, readMap } from "../map/log-store.ts";

registerVerb({
  name: "removed",
  summary: "List what is out of the map",
  run: ({ cwd, env, out }) => {
    const { map } = readMap(logPathFor(cwd, env));
    for (const removal of map.removals) {
      const [card, ...rest] = removal.nodes;
      const mode = removal.reparent ? "  (children moved up)" : "";
      out(`${removal.id}  ${card?.title ?? ""}${mode}`);
      if (rest.length > 0) {
        out(`  with it: ${rest.map((node) => node.id).join(", ")}`);
      }
    }
    return 0;
  },
});
