/** Picks the verb that the arguments name, runs it, and returns its exit code. */
import type { Registry, VerbContext } from "./registry.ts";

export type Io = Pick<VerbContext, "cwd" | "env" | "out" | "err">;

export async function main(
  argv: readonly string[],
  registry: Registry,
  io: Io,
): Promise<number> {
  const [name, ...args] = argv;
  const help = registry.get("help");
  if (name === undefined || name === "--help" || name === "-h") {
    return help ? await help.run({ ...io, args: [] }) : 0;
  }
  const verb = registry.get(name);
  if (!verb) {
    io.err(`werk: unknown verb "${name}"`);
    if (help) await help.run({ ...io, out: io.err, args: [] });
    return 2;
  }
  return await verb.run({ ...io, args });
}
