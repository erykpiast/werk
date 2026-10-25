// `remove` takes a card out with its subtree, or only the card with --reparent (#werk-remove).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";
import { removalActorRefusal } from "../map/removal-rules.ts";

const USAGE = "usage: remove <id> --actor you [--reparent] [--propose]";

registerVerb({
  name: "remove",
  summary:
    "Remove a card with its subtree, or only the card with --reparent; --propose stages it",
  run: ({ args, cwd, env, out, err }) => {
    const reparent = args.includes("--reparent");
    const propose = args.includes("--propose");
    const parsed = parseArgs(
      args.filter((arg) => arg !== "--reparent" && arg !== "--propose"),
      { flags: ["actor"] },
    );
    if (!parsed.ok || parsed.positional.length !== 1) {
      err(
        `werk: ${parsed.ok ? "remove needs one id" : parsed.error}\n${USAGE}`,
      );
      return 2;
    }
    if (!propose) {
      const unasked = removalActorRefusal(parsed.flags.actor, "remove");
      if (unasked) {
        err(`werk: refused: ${unasked.rule}: ${unasked.detail}\n${USAGE}`);
        return 1;
      }
    }
    const event: Record<string, unknown> = {
      type: propose ? "removal.proposed" : "node.removed",
      id: cardId(parsed.positional[0] as string),
    };
    if (reparent) event.reparent = true;
    if (!propose) event.actor = parsed.flags.actor;
    const result = appendEvents(logPathFor(cwd, env), [event]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}\n${USAGE}`,
      );
      return 1;
    }
    out(propose ? "removal proposed" : "removed");
    return 0;
  },
});
