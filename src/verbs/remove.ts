// `remove` takes a card out with its subtree, or only the card with --reparent (#werk-remove).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

const USAGE = "usage: remove <id> [--reparent]";

registerVerb({
  name: "remove",
  summary: "Remove a card with its subtree, or only the card with --reparent",
  run: ({ args, cwd, env, out, err }) => {
    const reparent = args.includes("--reparent");
    const parsed = parseArgs(
      args.filter((arg) => arg !== "--reparent"),
      { flags: [] },
    );
    if (!parsed.ok || parsed.positional.length !== 1) {
      err(
        `werk: ${parsed.ok ? "remove needs one id" : parsed.error}\n${USAGE}`,
      );
      return 2;
    }
    const event: Record<string, unknown> = {
      type: "node.removed",
      id: cardId(parsed.positional[0] as string),
    };
    if (reparent) event.reparent = true;
    const result = appendEvents(logPathFor(cwd, env), [event]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}\n${USAGE}`,
      );
      return 1;
    }
    out("removed");
    return 0;
  },
});
