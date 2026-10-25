// `search` prints the index of decided cards, or the cards that match every term (#werk-cli-search).
import { parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { renderIndex, renderMatches, searchCards } from "../map/find-search.ts";
import { STATUSES, type Status } from "../map/fold.ts";
import { logPathFor, readMap } from "../map/log-store.ts";

const USAGE = `usage: search ["term" ...] [--status ${STATUSES.join("|")}] [--under <id>]`;

registerVerb({
  name: "search",
  summary:
    "Print the index of decided cards, or the cards that match every term",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, {
      flags: ["status", "under"],
      idFlags: ["under"],
    });
    if (!parsed.ok) {
      err(`werk: ${parsed.error}\n${USAGE}`);
      return 2;
    }
    const status = parsed.flags.status;
    if (
      status !== undefined &&
      !(STATUSES as readonly string[]).includes(status)
    ) {
      err(`werk: --status must be one of ${STATUSES.join(", ")}\n${USAGE}`);
      return 2;
    }
    const under = parsed.flags.under ?? null;
    const { map } = readMap(logPathFor(cwd, env));
    if (under !== null && map.nodes.get(under)?.proposed !== false) {
      err(`werk: unknown card "${under}"`);
      return 1;
    }
    const found = searchCards(map, {
      terms: parsed.positional,
      status: (status as Status | undefined) ?? null,
      under,
    });
    const index = parsed.positional.length === 0 && status === undefined;
    if (found.length > 0)
      out(index ? renderIndex(found) : renderMatches(found));
    return 0;
  },
});
