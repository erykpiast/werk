// `rederive` ends the review of a marked card (#werk-cli-reopen, #rederive-reason).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { checkDecide } from "../map/contract.ts";
import { appendEvents, logPathFor, readMap } from "../map/log-store.ts";

const USAGE = `usage: rederive <id> [--confirm <id,id|all>] [--amend "<what changed>"] [--why "..."] [--status decided]`;

registerVerb({
  name: "rederive",
  summary: "End the review of a marked card: confirm it or amend it",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, {
      flags: ["confirm", "amend", "why", "status"],
    });
    if (!parsed.ok || parsed.positional.length !== 1) {
      err(
        `werk: ${parsed.ok ? "rederive needs one id" : parsed.error}\n${USAGE}`,
      );
      return 2;
    }
    const { flags } = parsed;
    if (flags.status !== undefined && flags.status !== "decided") {
      err(`werk: --status takes decided only\n${USAGE}`);
      return 2;
    }
    if (flags.amend !== undefined && flags.confirm !== undefined) {
      err(`werk: a review ends in a confirm or an amend, not both\n${USAGE}`);
      return 2;
    }
    const id = cardId(parsed.positional[0] as string);
    const path = logPathFor(cwd, env);
    const node = readMap(path).map.nodes.get(id);
    if (!node) {
      err(`werk: unknown card "${id}"`);
      return 1;
    }
    const deciding = flags.status === "decided";
    const marked = node.marks.some((mark) => mark.kind === "stale");
    const events: Record<string, unknown>[] = [];
    if (marked) {
      const links = (flags.confirm ?? "")
        .split(",")
        .map((part) => cardId(part.trim()))
        .filter((part) => part !== "");
      events.push({
        type: "node.reviewed",
        id,
        outcome: flags.amend === undefined ? "confirm" : "amend",
        confirmed:
          flags.confirm === "all"
            ? readMap(path)
                .map.edges.filter(
                  (e) => e.from === id && e.type === "depends_on",
                )
                .map((e) => e.to)
            : links,
        at: new Date().toISOString(),
        ...(flags.amend === undefined
          ? flags.why === undefined
            ? {}
            : { why: flags.why }
          : { why: flags.amend }),
        ...(deciding && node.status === "decided" ? { decide: true } : {}),
      });
    } else if (!(deciding && node.status !== "decided")) {
      if (deciding) {
        const violation = checkDecide(readMap(path).map, id);
        if (!violation) {
          out(`${id}: holds`);
          return 0;
        }
        err(`werk: refused: ${violation.rule}: ${violation.detail}`);
        return 1;
      }
      err(`werk: "${id}" has no stale mark to review`);
      return 1;
    }
    if (deciding && node.status !== "decided") {
      events.push({ type: "node.decided", id });
    }
    const result = appendEvents(path, events);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out(
      `${id}: ${flags.amend === undefined ? (marked ? "confirmed" : "decided") : "amended, next hop marked"}`,
    );
    return 0;
  },
});
