/** Splits the arguments of a verb into positional arguments and flag values. */

export type ArgSpec = {
  /** Every flag that takes a value, without the dashes. */
  flags: readonly string[];
  /** The flags whose value is a card id. They lose one leading hash sign (#werk-cli-hash-id). */
  idFlags?: readonly string[];
  /** Flags that take no value. A switch that is given has the value "". */
  switches?: readonly string[];
};

export type Parsed =
  | { ok: true; positional: string[]; flags: Record<string, string> }
  | { ok: false; error: string };

/** A card id from an argument: `#auth` and `auth` are the same id. Only one leading hash sign goes. */
export function cardId(arg: string): string {
  return arg.startsWith("#") ? arg.slice(1) : arg;
}

export function parseArgs(argv: readonly string[], spec: ArgSpec): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    const isSwitch = spec.switches?.includes(name) === true;
    if (!isSwitch && !spec.flags.includes(name))
      return { ok: false, error: `unknown flag --${name}` };
    if (name in flags)
      return { ok: false, error: `flag --${name} is given twice` };
    if (isSwitch) {
      flags[name] = "";
      continue;
    }
    let value: string | undefined;
    if (eq !== -1) value = arg.slice(eq + 1);
    else {
      value = argv[i + 1];
      i += 1;
    }
    if (value === undefined)
      return { ok: false, error: `flag --${name} needs a value` };
    flags[name] = spec.idFlags?.includes(name) ? cardId(value) : value;
  }
  return { ok: true, positional, flags };
}
