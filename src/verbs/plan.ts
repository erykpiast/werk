// `plan` turns a decided subtree into a spec and tickets (#werk-cli-build, #st-spec).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { logPathFor } from "../map/log-store.ts";
import { runPlan } from "../plan/run-plan.ts";

const USAGE = "usage: plan <subtree-id> [--timeout 600] [--silence 60]";

/** A flag of seconds as milliseconds, or null when it is not a positive number. */
function seconds(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback * 1000;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

registerVerb({
  name: "plan",
  summary: "Turn a decided subtree into one spec and checked tickets",
  run: async ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: ["timeout", "silence"] });
    if (!parsed.ok) {
      err(`werk: ${parsed.error}\n${USAGE}`);
      return 2;
    }
    const [root, ...extra] = parsed.positional;
    const timeoutMs = seconds(parsed.flags.timeout, 600);
    const silenceMs = seconds(parsed.flags.silence, 60);
    if (
      root === undefined ||
      extra.length > 0 ||
      timeoutMs === null ||
      silenceMs === null
    ) {
      err(`werk: plan needs one subtree id and positive limits\n${USAGE}`);
      return 2;
    }
    return runPlan({
      root: cardId(root),
      cwd,
      logPath: logPathFor(cwd, env),
      env,
      timeoutMs,
      silenceMs,
      out,
      err,
    });
  },
});
