// `inbox` prints the notes of every thread, with their log positions (#werk-cli-notes).
import { parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import { logPathFor, readMap } from "../map/log-store.ts";
import { inboxLines } from "../map/thread.ts";

const USAGE = "usage: inbox [--since <seq>] [-n 20]";

registerVerb({
  name: "inbox",
  summary: "Print the notes, after an optional log position",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(
      args.map((arg) => (arg === "-n" ? "--n" : arg)),
      { flags: ["since", "n"] },
    );
    if (!parsed.ok || parsed.positional.length > 0) {
      err(`werk: ${parsed.ok ? "inbox takes no id" : parsed.error}\n${USAGE}`);
      return 2;
    }
    const since = Number(parsed.flags.since ?? 0);
    const count = Number(parsed.flags.n ?? 20);
    if (!Number.isInteger(since) || !Number.isInteger(count) || count < 1) {
      err(`werk: --since and -n must be whole numbers\n${USAGE}`);
      return 2;
    }
    const { map } = readMap(logPathFor(cwd, env));
    for (const line of inboxLines(map, since, count)) out(line);
    return 0;
  },
});
