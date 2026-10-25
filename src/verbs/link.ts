// `link` and `unlink` add or remove one typed link (#werk-cli-link).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { LINK_TYPES } from "../map/fold.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

const TYPES = LINK_TYPES.join("|");

type Env = Record<string, string | undefined>;
type Io = {
  args: string[];
  cwd: string;
  env: Env;
  out: (text: string) => void;
  err: (text: string) => void;
};

function change(verb: "link" | "unlink", { args, cwd, env, out, err }: Io) {
  const usage =
    verb === "link"
      ? `usage: link <from> <to> --type ${TYPES} [--why "..."]`
      : `usage: unlink <from> <to> --type ${TYPES}`;
  const parsed = parseArgs(args, {
    flags: verb === "link" ? ["type", "why"] : ["type"],
  });
  if (!parsed.ok) {
    err(`werk: ${parsed.error}\n${usage}`);
    return 2;
  }
  const [from, to, ...extra] = parsed.positional;
  const type = parsed.flags.type;
  if (from === undefined || to === undefined || extra.length > 0) {
    err(`werk: ${verb} needs two ids\n${usage}`);
    return 2;
  }
  if (type === undefined || !(LINK_TYPES as readonly string[]).includes(type)) {
    err(`werk: ${verb} needs --type ${TYPES}\n${usage}`);
    return 2;
  }
  const event: Record<string, unknown> = {
    type: verb === "link" ? "edge.added" : "edge.removed",
    from: cardId(from),
    to: cardId(to),
    link: type,
  };
  if (verb === "link" && parsed.flags.why !== undefined) {
    event.why = parsed.flags.why;
  }
  const result = appendEvents(logPathFor(cwd, env), [event]);
  if (!result.ok) {
    err(`werk: refused: ${result.violation.rule}: ${result.violation.detail}`);
    return 1;
  }
  out(verb === "link" ? "linked" : "unlinked");
  return 0;
}

registerVerb({
  name: "link",
  summary: "Add one typed link between two cards",
  run: (io) => change("link", io),
});

registerVerb({
  name: "unlink",
  summary: "Remove one typed link between two cards",
  run: (io) => change("unlink", io),
});
