// `accept` commits one ghost, with the ghost cards and evidence it carries (#werk-cli-propose).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

const USAGE = "usage: accept <id> --actor you";

registerVerb({
  name: "accept",
  summary: "Commit a ghost; only for a person's accept",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: ["actor"] });
    if (!parsed.ok || parsed.positional.length !== 1) {
      err(
        `werk: ${parsed.ok ? "accept needs one id" : parsed.error}\n${USAGE}`,
      );
      return 2;
    }
    const event: Record<string, unknown> = {
      type: "node.accepted",
      id: cardId(parsed.positional[0] as string),
    };
    if (parsed.flags.actor !== undefined) event.actor = parsed.flags.actor;
    const result = appendEvents(logPathFor(cwd, env), [event]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}\n${USAGE}`,
      );
      return 1;
    }
    out("accepted");
    return 0;
  },
});
