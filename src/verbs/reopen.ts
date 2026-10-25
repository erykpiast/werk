// `reopen` takes a decided card back to open, with a reason (#werk-cli-reopen).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { REOPEN_REASONS } from "../map/fold.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

const USAGE = `usage: reopen <id> [--reason ${REOPEN_REASONS.join("|")}] [--why "..."]`;

registerVerb({
  name: "reopen",
  summary: "Reopen a decided card, with a reason and a text",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: ["reason", "why"] });
    if (!parsed.ok || parsed.positional.length !== 1) {
      err(
        `werk: ${parsed.ok ? "reopen needs one id" : parsed.error}\n${USAGE}`,
      );
      return 2;
    }
    const reason = parsed.flags.reason ?? "invalidated";
    if (!(REOPEN_REASONS as readonly string[]).includes(reason)) {
      err(
        `werk: --reason must be one of ${REOPEN_REASONS.join(", ")}\n${USAGE}`,
      );
      return 2;
    }
    const id = cardId(parsed.positional[0] as string);
    const event: Record<string, unknown> = {
      type: "node.reopened",
      id,
      reason,
      at: new Date().toISOString(),
    };
    if (parsed.flags.why !== undefined) event.why = parsed.flags.why;
    const result = appendEvents(logPathFor(cwd, env), [event]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out(`${id}: reopened, ${reason}`);
    return 0;
  },
});
