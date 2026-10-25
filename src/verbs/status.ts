// `status` moves a card to decided once the four-fact check passes (#werk-cli-decide).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

const USAGE = "usage: status <id> decided";

registerVerb({
  name: "status",
  summary: "Move a card to decided, after the contract check",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: [] });
    if (
      !parsed.ok ||
      parsed.positional.length !== 2 ||
      parsed.positional[1] !== "decided"
    ) {
      err(
        `werk: ${parsed.ok ? "status needs one id and decided" : parsed.error}\n${USAGE}`,
      );
      return 2;
    }
    const id = cardId(parsed.positional[0] as string);
    const result = appendEvents(logPathFor(cwd, env), [
      { type: "node.decided", id },
    ]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out(`${id}: decided`);
    return 0;
  },
});
