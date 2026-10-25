// `find` lists the open and proto cards that can be worked on now (#werk-find, #werk-find-scope).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { findOpen, renderMatches } from "../map/find-search.ts";
import { logPathFor, readMap } from "../map/log-store.ts";

const USAGE = "usage: find [<id>]";

registerVerb({
  name: "find",
  summary: "List the open and proto cards that can be worked on now",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: [] });
    if (!parsed.ok || parsed.positional.length > 1) {
      err(
        `werk: ${parsed.ok ? "find takes at most one id" : parsed.error}\n${USAGE}`,
      );
      return 2;
    }
    const { map } = readMap(logPathFor(cwd, env));
    const root = parsed.positional[0];
    if (root !== undefined && map.nodes.get(cardId(root))?.proposed !== false) {
      err(`werk: unknown card "${cardId(root)}"`);
      return 1;
    }
    const found = findOpen(map, root === undefined ? null : cardId(root));
    out(found.length === 0 ? "no open card" : renderMatches(found));
    return 0;
  },
});
