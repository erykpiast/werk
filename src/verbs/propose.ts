// `propose` stages a change to the title, the why or the body of a card as tagged changes (#werk-cli-propose).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

const USAGE =
  'usage: propose <id> [--title "..."] [--why "..."] [--ops \'[{"tag":"elaborated","old":"...","new":"..."},{"tag":"new","new":"..."},{"tag":"removed","old":"..."}]\']';

registerVerb({
  name: "propose",
  summary: "Stage a change to a card's title, why or body",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: ["title", "why", "ops"] });
    if (!parsed.ok || parsed.positional.length !== 1) {
      err(
        `werk: ${parsed.ok ? "propose needs one id" : parsed.error}\n${USAGE}`,
      );
      return 2;
    }
    const { title, why, ops } = parsed.flags;
    let tagged: unknown;
    if (ops !== undefined) {
      try {
        tagged = JSON.parse(ops);
      } catch (error) {
        err(
          `werk: --ops is not JSON: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`,
        );
        return 2;
      }
    }
    const id = cardId(parsed.positional[0] as string);
    const result = appendEvents(logPathFor(cwd, env), [
      {
        type: "change.proposed",
        id,
        ...(title === undefined ? {} : { title }),
        ...(why === undefined ? {} : { why }),
        ...(ops === undefined ? {} : { ops: tagged }),
      },
    ]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}\n${USAGE}`,
      );
      return 1;
    }
    out(`${id}: change proposed`);
    return 0;
  },
});
