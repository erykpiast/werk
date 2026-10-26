// The start-up of the command line. It starts the chosen verb and does not wait for it, so the
// first evaluation ends at once and a hot reload can run; when the verb ends, a callback gets
// its exit code (#werk-hmr-entry-settles).
import { parseArgs } from "./args.ts";
import { formatHelp } from "./help.ts";
import type { Io, Registry } from "./registry.ts";

/** The exit code of a call the command line cannot read: no verb, an unknown verb, or a wrong argument. */
export const USAGE_ERROR = 2;

export async function runVerb(argv: string[], verbs: Registry, io: Io): Promise<number> {
  const [name, ...rest] = argv;
  const verb = name === undefined ? undefined : verbs.get(name);
  if (verb === undefined) {
    if (name !== undefined) io.err(`werk: unknown verb ${name}\n\n`);
    io.err(formatHelp(verbs.list()));
    return USAGE_ERROR;
  }
  const parsed = parseArgs(verb, rest);
  if (!parsed.ok) {
    io.err(`werk ${verb.name}: ${parsed.error}\nRun werk help to see its arguments and flags.\n`);
    return USAGE_ERROR;
  }
  try {
    return await verb.run(parsed.args, io);
  } catch (error) {
    io.err(`werk ${verb.name}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function start(argv: string[], verbs: Registry, io: Io, exit: (code: number) => void): void {
  void runVerb(argv, verbs, io).then(exit);
}
