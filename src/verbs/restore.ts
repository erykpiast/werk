// `restore` undoes one removal exactly (#werk-remove-restore-undo).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

registerVerb({
  name: "restore",
  summary: "Undo one removal, the moved children too",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: [] });
    if (!parsed.ok || parsed.positional.length !== 1) {
      err(
        `werk: ${parsed.ok ? "restore needs one id" : parsed.error}\nusage: restore <id>`,
      );
      return 2;
    }
    const result = appendEvents(logPathFor(cwd, env), [
      { type: "node.restored", id: cardId(parsed.positional[0] as string) },
    ]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out("restored");
    return 0;
  },
});
