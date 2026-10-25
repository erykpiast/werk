// `target` sets the project's target repository, or prints it (#werk-cli-build, #st-build-target).
import { dirname } from "node:path";
import {
  appendBoardEvent,
  boardLogPathFor,
  readBoard,
} from "../board/log-store.ts";
import { parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { logPathFor } from "../map/log-store.ts";
import { checkTarget } from "../plan/target.ts";

const USAGE = "usage: target [<path>]";

registerVerb({
  name: "target",
  summary: "Set the target repository of the project, or print it",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: [] });
    if (!parsed.ok || parsed.positional.length > 1) {
      err(
        `werk: ${parsed.ok ? "target takes at most one path" : parsed.error}\n${USAGE}`,
      );
      return 2;
    }
    const boardLog = boardLogPathFor(cwd, env);
    const [given] = parsed.positional;
    if (given === undefined) {
      const current = readBoard(boardLog).target;
      if (current === undefined) {
        err("werk: no target is set. Set one with: werk target <path>");
        return 1;
      }
      out(current);
      return 0;
    }
    const checked = checkTarget(cwd, given, dirname(logPathFor(cwd, env)));
    if (!checked.ok) {
      err(`werk: refused: ${checked.error}`);
      return 1;
    }
    const result = appendBoardEvent(boardLog, {
      type: "project.target",
      path: checked.path,
    });
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out(checked.path);
    return 0;
  },
});
