// `edit` sets who, or the body of an open card; a ghost's words are frozen (#werk-cli-edit, #werk-cli-retitle).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

const USAGE =
  "usage: edit <id> [--who you|me|prototype] | edit <id> --body <text>";

registerVerb({
  name: "edit",
  summary: "Set who decides a card, or edit its body",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: ["who", "body"] });
    if (!parsed.ok || parsed.positional.length !== 1) {
      err(`werk: ${parsed.ok ? "edit needs one id" : parsed.error}\n${USAGE}`);
      return 2;
    }
    const { who, body } = parsed.flags;
    if ((who === undefined) === (body === undefined)) {
      err(`werk: edit takes --who or --body, one at a time\n${USAGE}`);
      return 2;
    }
    const id = cardId(parsed.positional[0] as string);
    const result = appendEvents(logPathFor(cwd, env), [
      { type: "node.edited", id, ...(who !== undefined ? { who } : { body }) },
    ]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out(`${id}: edited`);
    return 0;
  },
});
