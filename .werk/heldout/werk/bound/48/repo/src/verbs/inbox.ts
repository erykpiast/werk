// `werk inbox` prints the notes the person typed in the map, in log order (#werk-cli-notes).
import { registerVerb } from "../cli/registry.ts";
import { USAGE_ERROR } from "../cli/start.ts";
import { formatInbox } from "../map/notes.ts";
import { formatProblems } from "../map/show.ts";
import { logPath, readMap } from "../map/store.ts";

const DEFAULT_COUNT = 20;

/** A whole number of at least `least`, or undefined. */
function wholeNumber(raw: string | true | undefined, fallback: number, least: number): number | undefined {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= least ? value : undefined;
}

registerVerb({
  name: "inbox",
  help: "Print the notes typed in the map, in log order.",
  flags: [
    { name: "since", value: "text", help: "Start after this log position." },
    { name: "n", value: "text", help: `Print at most this many notes (default ${DEFAULT_COUNT}).` },
  ],
  run: ({ flags }, io) => {
    const since = wholeNumber(flags.since, 0, 0);
    const count = wholeNumber(flags.n, DEFAULT_COUNT, 1);
    if (since === undefined || count === undefined) {
      io.err("werk inbox: --since is a log position and -n is a count of at least 1\n");
      return USAGE_ERROR;
    }
    const map = readMap("inbox", logPath());
    io.err(formatProblems(map.problems));
    io.out(formatInbox(map, { since, count }));
    return 0;
  },
});
