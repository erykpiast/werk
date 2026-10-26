// Reads a verb's arguments against the positionals and flags it registered. Every value of kind
// `id` goes through cardId, so `#auth` and `auth` name the same card (#werk-cli-hash-id).
import { cardId } from "./card-id.ts";
import type { ValueKind, Verb, VerbArgs } from "./registry.ts";

export type Parsed = { ok: true; args: VerbArgs } | { ok: false; error: string };

function read(kind: ValueKind, raw: string): string {
  return kind === "id" ? cardId(raw) : raw;
}

export function parseArgs(verb: Verb, argv: string[]): Parsed {
  const specs = verb.positionals ?? [];
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    // A one-letter flag is written with one dash, as `-n 20` (#werk-cli-notes).
    const short = /^-[A-Za-z]$/.test(arg) ? verb.flags?.find((f) => f.name === arg.slice(1)) : undefined;
    if (short?.value === undefined && short !== undefined) {
      flags[short.name] = true;
      continue;
    }
    if (short?.value !== undefined) {
      const raw = argv[++i];
      if (raw === undefined) return { ok: false, error: `${arg} needs a value` };
      flags[short.name] = read(short.value, raw);
      continue;
    }
    if (!arg.startsWith("--")) {
      const spec = specs[positionals.length];
      if (spec === undefined) return { ok: false, error: `${verb.name} takes no argument ${arg}` };
      positionals.push(read(spec.value, arg));
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const flag = verb.flags?.find((f) => f.name === name);
    if (flag === undefined) return { ok: false, error: `${verb.name} has no flag --${name}` };
    if (flag.value === undefined) {
      if (eq !== -1) return { ok: false, error: `--${name} takes no value` };
      flags[name] = true;
      continue;
    }
    const raw = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (raw === undefined) return { ok: false, error: `--${name} needs a value` };
    flags[name] = read(flag.value, raw);
  }
  const missing = specs.slice(positionals.length).find((spec) => !spec.optional);
  if (missing !== undefined) return { ok: false, error: `${verb.name} needs <${missing.name}>` };
  return { ok: true, args: { positionals, flags } };
}
