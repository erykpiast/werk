// `followup` records a request to change a finished build, with its class (#werk-cli-followup).

import { followupLines } from "../board/followup-records.ts";
import {
  appendBoardEvent,
  boardLogPathFor,
  readBoard,
} from "../board/log-store.ts";
import { resolveTicket } from "../board/resolve.ts";
import { parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";

const USAGE = `usage: followup <ticket> --class plan|build --found review|after-merge --why "..." [--catchable yes|no] [--of <n>]
       followup <ticket> --list`;

registerVerb({
  name: "followup",
  summary: "Record a follow-up request on a finished ticket, with its class",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, {
      flags: ["class", "found", "why", "catchable", "of"],
      switches: ["list"],
    });
    if (!parsed.ok) {
      err(`werk: ${parsed.error}\n${USAGE}`);
      return 2;
    }
    const [number, ...extra] = parsed.positional;
    if (number === undefined || extra.length > 0) {
      err(`werk: followup needs one ticket\n${USAGE}`);
      return 2;
    }
    const { flags } = parsed;
    const listing = "list" in flags;
    if (listing && Object.keys(flags).length > 1) {
      err(`werk: --list takes no other flag\n${USAGE}`);
      return 2;
    }
    if (
      !listing &&
      (flags.class === undefined ||
        flags.found === undefined ||
        flags.why === undefined)
    ) {
      err(`werk: followup needs --class, --found and --why\n${USAGE}`);
      return 2;
    }
    const catchable = flags.catchable;
    if (catchable !== undefined && catchable !== "yes" && catchable !== "no") {
      err(`werk: --catchable is yes or no\n${USAGE}`);
      return 2;
    }
    let of: number | undefined;
    if (flags.of !== undefined) {
      of = /^\d+$/.test(flags.of) ? Number(flags.of) : Number.NaN;
      if (Number.isNaN(of)) {
        err(`werk: --of is a record number\n${USAGE}`);
        return 2;
      }
    }
    const path = boardLogPathFor(cwd, env);
    const board = readBoard(path);
    const found = resolveTicket(board, number);
    if (!found.ok) {
      err(`werk: refused: ${found.error}`);
      return 1;
    }
    if (listing) {
      const records = board.tickets.get(found.id)?.followupRecords ?? [];
      for (const line of followupLines(records)) out(line);
      return 0;
    }
    const event: Record<string, unknown> = {
      type: "ticket.followup_recorded",
      id: found.id,
      class: flags.class,
      found: flags.found,
      why: flags.why,
    };
    if (catchable !== undefined) event.catchable = catchable === "yes";
    if (of !== undefined) event.of = of;
    const result = appendBoardEvent(path, event);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out("recorded");
    return 0;
  },
});
