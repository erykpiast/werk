// `show` prints one card with its words, status and links (#werk-cli-show).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { renderCard, rootCardId } from "../map/card-text.ts";
import { logPathFor, readMap } from "../map/log-store.ts";

registerVerb({
  name: "show",
  summary: "Print one card with its links",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: [] });
    if (!parsed.ok || parsed.positional.length > 1) {
      err(
        `werk: ${parsed.ok ? "show takes at most one id" : parsed.error}\nusage: show [<id>]`,
      );
      return 2;
    }
    const { map } = readMap(logPathFor(cwd, env));
    const given = parsed.positional[0];
    const id = given === undefined ? rootCardId(map) : cardId(given);
    if (id === null) {
      err("werk: the map has no card");
      return 1;
    }
    for (const problem of map.problems) {
      err(
        `werk: problem at log line ${problem.line}: ${problem.rule}: ${problem.detail}`,
      );
    }
    const text = renderCard(map, id);
    if (text === null) {
      err(`werk: unknown card "${id}"`);
      return 1;
    }
    out(text);
    return 0;
  },
});
