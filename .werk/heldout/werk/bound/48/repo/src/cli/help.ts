// The help text of the command line: every registered verb with its flags (#werk-cli, #werk-verb-registry).
import type { FlagSpec, PositionalSpec, Verb } from "./registry.ts";

function usage(spec: PositionalSpec): string {
  return spec.optional ? `[<${spec.name}>]` : `<${spec.name}>`;
}

function flagForm(flag: FlagSpec): string {
  const dashes = flag.name.length === 1 ? "-" : "--";
  return flag.value === undefined ? `${dashes}${flag.name}` : `${dashes}${flag.name} <${flag.value}>`;
}

export function formatVerb(verb: Verb): string {
  const head = [verb.name, ...(verb.positionals ?? []).map(usage)].join(" ");
  const flags = verb.flags ?? [];
  const width = Math.max(0, ...flags.map((flag) => flagForm(flag).length));
  const lines = [`  ${head}`, `      ${verb.help}`];
  for (const flag of flags) lines.push(`      ${flagForm(flag).padEnd(width)}  ${flag.help}`);
  return lines.join("\n");
}

export function formatHelp(verbs: Verb[]): string {
  return [
    "Usage: werk <verb> [arguments] [flags]",
    "",
    "A card id may start with one #: #auth and auth name the same card.",
    "",
    "Verbs:",
    "",
    verbs.map(formatVerb).join("\n\n"),
    "",
  ].join("\n");
}
