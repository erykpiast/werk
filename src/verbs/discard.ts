// `discard` drops a ghost with its ghost descendants and the evidence no other card cites (#werk-cli-propose).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

registerVerb({
  name: "discard",
  summary: "Drop a ghost and what only it carried",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: [] });
    if (!parsed.ok || parsed.positional.length !== 1) {
      err(
        `werk: ${parsed.ok ? "discard needs one id" : parsed.error}\nusage: discard <id>`,
      );
      return 2;
    }
    const result = appendEvents(logPathFor(cwd, env), [
      { type: "node.discarded", id: cardId(parsed.positional[0] as string) },
    ]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out("discarded");
    return 0;
  },
});
