// `link` adds one typed link (#werk-cli-link).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { LINK_TYPES } from "../map/fold.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

const TYPES = LINK_TYPES.join("|");
const USAGE = `usage: link <from> <to> --type ${TYPES} [--why "..."]`;

registerVerb({
  name: "link",
  summary: "Add one typed link between two cards",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: ["type", "why"] });
    if (!parsed.ok) {
      err(`werk: ${parsed.error}\n${USAGE}`);
      return 2;
    }
    const [from, to, ...extra] = parsed.positional;
    const type = parsed.flags.type;
    if (from === undefined || to === undefined || extra.length > 0) {
      err(`werk: link needs two ids\n${USAGE}`);
      return 2;
    }
    if (
      type === undefined ||
      !(LINK_TYPES as readonly string[]).includes(type)
    ) {
      err(`werk: link needs --type ${TYPES}\n${USAGE}`);
      return 2;
    }
    const event: Record<string, unknown> = {
      type: "edge.added",
      from: cardId(from),
      to: cardId(to),
      link: type,
    };
    if (parsed.flags.why !== undefined) event.why = parsed.flags.why;
    const result = appendEvents(logPathFor(cwd, env), [event]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out("linked");
    return 0;
  },
});
