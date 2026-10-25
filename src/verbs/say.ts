// `say` writes one note on a card's thread (#werk-cli-notes).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

registerVerb({
  name: "say",
  summary: "Write a note on a card's thread",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: [] });
    const [id, text, ...extra] = parsed.ok ? parsed.positional : [];
    if (
      !parsed.ok ||
      id === undefined ||
      text === undefined ||
      extra.length > 0
    ) {
      err(
        `werk: ${parsed.ok ? "say needs an id and a note" : parsed.error}\nusage: say <id> "..."`,
      );
      return 2;
    }
    const result = appendEvents(logPathFor(cwd, env), [
      { type: "note.added", id: cardId(id), by: "agent", text },
    ]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out("noted");
    return 0;
  },
});
