// `stale` lists the marked cards in the order to fix them (#werk-cli-stale).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { logPathFor, readMap } from "../map/log-store.ts";
import {
  listMarked,
  MARK_KINDS,
  type MarkKind,
  renderMarked,
} from "../map/stale-list.ts";

const USAGE = `usage: stale [<id>] [--kind ${MARK_KINDS.join("|")}]`;

registerVerb({
  name: "stale",
  summary: "List the marked cards, a basis before the card on it",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: ["kind"] });
    if (!parsed.ok || parsed.positional.length > 1) {
      err(
        `werk: ${parsed.ok ? "stale takes at most one id" : parsed.error}\n${USAGE}`,
      );
      return 2;
    }
    const kind = parsed.flags.kind;
    if (
      kind !== undefined &&
      !(MARK_KINDS as readonly string[]).includes(kind)
    ) {
      err(`werk: --kind must be one of ${MARK_KINDS.join(", ")}\n${USAGE}`);
      return 2;
    }
    const { map } = readMap(logPathFor(cwd, env));
    const root = parsed.positional[0];
    if (root !== undefined && !map.nodes.has(cardId(root))) {
      err(`werk: unknown card "${cardId(root)}"`);
      return 1;
    }
    out(
      renderMarked(
        listMarked(
          map,
          root === undefined ? null : cardId(root),
          (kind as MarkKind | undefined) ?? null,
        ),
      ),
    );
    return 0;
  },
});
