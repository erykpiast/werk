// `ticket restore` puts one archived ticket back where it was (#werk-cli-ticket-restore).

import {
  appendBoardEvent,
  boardLogPathFor,
  readBoard,
} from "../board/log-store.ts";
import { resolveTicket } from "../board/resolve.ts";
import { parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";

const USAGE = "usage: ticket restore <number> [--actor you]";

registerVerb({
  name: "ticket",
  summary: "Restore an archived ticket (subverb: restore)",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: ["actor"] });
    if (!parsed.ok) {
      err(`werk: ${parsed.error}\n${USAGE}`);
      return 2;
    }
    const [sub, number, ...extra] = parsed.positional;
    if (sub !== "restore" || number === undefined || extra.length > 0) {
      err(`werk: ticket needs the subverb restore and one number\n${USAGE}`);
      return 2;
    }
    const actor = parsed.flags.actor ?? "agent";
    if (actor !== "you" && actor !== "agent") {
      err(`werk: --actor is you\n${USAGE}`);
      return 2;
    }
    const path = boardLogPathFor(cwd, env);
    const found = resolveTicket(readBoard(path), number);
    if (!found.ok) {
      err(`werk: refused: ${found.error}`);
      return 1;
    }
    const result = appendBoardEvent(path, {
      type: "ticket.restored",
      ticket: found.id,
      actor,
    });
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
