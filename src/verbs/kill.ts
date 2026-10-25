// `kill` records one kill criterion on a card (#kill, #kill-shape).
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { appendEvents, logPathFor } from "../map/log-store.ts";

const USAGE = `usage: kill <id> one of:
  --metric "..." --source "..." --threshold "..." --window "..." --sample "..."
  --manual "how the author tests it"
  --no-metric "why there is no metric"
  --revisit`;

const METRIC_FLAGS = ["metric", "source", "threshold", "window", "sample"];

/** The event fields for the one form the flags name, or the reason there is none. */
function criterion(
  flags: Record<string, string>,
): { fields: Record<string, string> } | { error: string } {
  const forms = [
    METRIC_FLAGS.some((key) => key in flags) ? "metric" : null,
    "manual" in flags ? "manual" : null,
    "no-metric" in flags ? "no-metric" : null,
    "revisit" in flags ? "revisit" : null,
  ].filter((form) => form !== null);
  if (forms.length !== 1) return { error: "kill takes exactly one form" };
  if (forms[0] === "metric") {
    const missing = METRIC_FLAGS.filter((key) => !(key in flags));
    if (missing.length > 0) {
      return { error: `a metric needs --${missing.join(", --")} too` };
    }
    return { fields: { form: "metric", ...flags } };
  }
  if (forms[0] === "manual")
    return { fields: { form: "manual", test: flags.manual as string } };
  if (forms[0] === "no-metric") {
    return {
      fields: { form: "no-metric", reason: flags["no-metric"] as string },
    };
  }
  return { fields: { form: "revisit" } };
}

registerVerb({
  name: "kill",
  summary: "Record one kill criterion on a card",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, {
      flags: [...METRIC_FLAGS, "manual", "no-metric"],
      switches: ["revisit"],
    });
    if (!parsed.ok || parsed.positional.length !== 1) {
      err(`werk: ${parsed.ok ? "kill needs one id" : parsed.error}\n${USAGE}`);
      return 2;
    }
    const shape = criterion(parsed.flags);
    if ("error" in shape) {
      err(`werk: ${shape.error}\n${USAGE}`);
      return 2;
    }
    const id = cardId(parsed.positional[0] as string);
    const result = appendEvents(logPathFor(cwd, env), [
      { type: "criterion.added", id, ...shape.fields },
    ]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out(`${id}: kill criterion recorded`);
    return 0;
  },
});
