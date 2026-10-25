// `edit` sets who and records the two waivers; a card's words change only through a proposal, and a ghost's are frozen (#werk-cli-edit, #werk-contract-waiver-reason).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

const USAGE =
  'usage: edit <id> [--who you|me|prototype] [--no-basis "<reason>"] [--unchallenged "<reason>"] (a change of words goes through propose)';

/** Each flag and the field it sets in the event. */
const FIELDS = {
  who: "who",
  "no-basis": "noBasis",
  unchallenged: "unchallenged",
} as const;

registerVerb({
  name: "edit",
  summary: "Set who decides a card",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: ["body", ...Object.keys(FIELDS)] });
    if (!parsed.ok || parsed.positional.length !== 1) {
      err(`werk: ${parsed.ok ? "edit needs one id" : parsed.error}\n${USAGE}`);
      return 2;
    }
    const { body } = parsed.flags;
    const given = Object.keys(FIELDS).filter((flag) => flag in parsed.flags);
    if ((given.length === 0) === (body === undefined)) {
      err(`werk: edit takes --body or the other flags, not both\n${USAGE}`);
      return 2;
    }
    const id = cardId(parsed.positional[0] as string);
    const result = appendEvents(logPathFor(cwd, env), [
      {
        type: "node.edited",
        id,
        ...(body !== undefined
          ? { body }
          : Object.fromEntries(
              given.map((flag) => [
                FIELDS[flag as keyof typeof FIELDS],
                parsed.flags[flag],
              ]),
            )),
      },
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
