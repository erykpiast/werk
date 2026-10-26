// `werk kill` records one kill criterion on a card per call (#kill-ask, #kill-shape). One flag
// names the form: a metric with its source, threshold and window, a manual test, a reason that no
// metric applies, or revisit at any time.
import { registerVerb } from "../cli/registry.ts";
import { describeKill, formatProblems } from "../map/show.ts";
import { logPath, readMap, write } from "../map/store.ts";
import { KILL_FORMS, type KillCriterion } from "../map/types.ts";

const FORMS = "--metric (with --source, --threshold and --window), --manual, --no-metric or --revisit";

type Flags = Record<string, string | true>;

/** The criterion the flags name, or the reason they name none. */
function criterionOf(flags: Flags): KillCriterion | string {
  const named = KILL_FORMS.filter((form) => flags[form] !== undefined);
  if (named.length !== 1) return `names one form: ${FORMS}`;
  const text = (name: string) => (typeof flags[name] === "string" ? flags[name] : "");
  switch (named[0]) {
    case "metric":
      return {
        form: "metric",
        metric: text("metric"),
        source: text("source"),
        threshold: text("threshold"),
        window: text("window"),
      };
    case "manual":
      return { form: "manual", test: text("manual") };
    case "no-metric":
      return { form: "no-metric", reason: text("no-metric") };
    default:
      return { form: "revisit" };
  }
}

registerVerb({
  name: "kill",
  help: "Record one kill criterion on a card: what must become true to revisit the decision.",
  positionals: [{ name: "id", value: "id" }],
  flags: [
    { name: "metric", value: "text", help: "The metric to track. Needs --source, --threshold and --window." },
    { name: "source", value: "text", help: "Where the metric comes from." },
    { name: "threshold", value: "text", help: "The value that fires the criterion." },
    { name: "window", value: "text", help: "The time window the metric is read over." },
    { name: "manual", value: "text", help: "The test the author runs by hand." },
    { name: "no-metric", value: "text", help: "Why no metric applies." },
    { name: "revisit", help: "Revisit at any time." },
  ],
  run: ({ positionals, flags }, io) => {
    const id = positionals[0] as string;
    const criterion = criterionOf(flags);
    if (typeof criterion === "string") {
      io.err(`werk kill: a criterion ${criterion}\n`);
      return 1;
    }
    const log = logPath();
    const map = readMap("kill", log);
    io.err(formatProblems(map.problems));
    write(map, [{ type: "kill.added", actor: "agent", payload: { id, criterion } }], log);
    io.out(`${id}: kill criterion recorded: ${describeKill(criterion)}\n`);
    return 0;
  },
});
