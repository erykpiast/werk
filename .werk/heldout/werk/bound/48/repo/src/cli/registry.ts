// The command line finds its verbs by registration (#werk-verb-registry). Each verb module calls
// registerVerb once; the list of verb modules holds only their imports (#werk-stack-modules).

/** What an argument holds. An `id` names a card and loses one leading `#`; `text` stays as written. */
export type ValueKind = "id" | "text";

export type PositionalSpec = { name: string; value: ValueKind; optional?: boolean };

/** A flag with no `value` is a switch: present or absent. A one-letter flag is written with one dash. */
export type FlagSpec = { name: string; value?: ValueKind; help: string };

export type Io = { out(text: string): void; err(text: string): void };

export type VerbArgs = { positionals: string[]; flags: Record<string, string | true> };

export type Verb = {
  name: string;
  help: string;
  positionals?: PositionalSpec[];
  flags?: FlagSpec[];
  run(args: VerbArgs, io: Io): number | Promise<number>;
};

export class Registry {
  readonly #verbs = new Map<string, Verb>();

  register(verb: Verb): void {
    if (this.#verbs.has(verb.name)) throw new Error(`the verb ${verb.name} is registered twice`);
    this.#verbs.set(verb.name, verb);
  }

  get(name: string): Verb | undefined {
    return this.#verbs.get(name);
  }

  /** Every registered verb, by name. */
  list(): Verb[] {
    return [...this.#verbs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** The registry of the werk command line. */
export const registry = new Registry();

export function registerVerb(verb: Verb): void {
  registry.register(verb);
}
