// `add` proposes a card as a ghost (#werk-cli-add, #werk-propose-new).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { STATUSES } from "../map/fold.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

const USAGE =
  'usage: add <id> --title "..." [--why "..."] [--body "..."] [--parent <id>] [--status open|proto]';

const TEXT_FLAGS = ["why", "body"] as const;

registerVerb({
  name: "add",
  summary: "Propose a card as a ghost",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, {
      flags: ["title", "parent", "status", ...TEXT_FLAGS],
      idFlags: ["parent"],
    });
    if (!parsed.ok) {
      err(`werk: ${parsed.error}\n${USAGE}`);
      return 2;
    }
    const [rawId, ...extra] = parsed.positional;
    const { flags } = parsed;
    if (rawId === undefined || extra.length > 0 || flags.title === undefined) {
      err(`werk: add needs one id and --title\n${USAGE}`);
      return 2;
    }
    const id = cardId(rawId);
    const status = flags.status ?? "open";
    if (status === "decided") {
      err(
        "werk: refused: a card reaches decided only through the status verb, not add",
      );
      return 1;
    }
    if (!(STATUSES as readonly string[]).includes(status)) {
      err(`werk: --status must be open or proto`);
      return 2;
    }
    const event: Record<string, unknown> = {
      type: "node.proposed",
      id,
      kind: "card",
      title: flags.title,
      status,
    };
    for (const key of [...TEXT_FLAGS, "parent"] as const) {
      if (flags[key] !== undefined) event[key] = flags[key];
    }
    const result = appendEvents(logPathFor(cwd, env), [event]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out("proposed");
    return 0;
  },
});
