/** The table of verbs. A verb module registers itself here (#werk-verb-registry). */

export type VerbContext = {
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
};

export type Verb = {
  name: string;
  /** One line for the help output. */
  summary: string;
  /** Returns the exit code. */
  run: (ctx: VerbContext) => number | Promise<number>;
};

export type Registry = {
  register: (verb: Verb) => void;
  get: (name: string) => Verb | undefined;
  list: () => Verb[];
};

export function createRegistry(): Registry {
  const verbs = new Map<string, Verb>();
  return {
    // A second registration of a name replaces the first, so a hot reload of a verb module works.
    register: (verb) => void verbs.set(verb.name, verb),
    get: (name) => verbs.get(name),
    list: () =>
      [...verbs.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export const registry: Registry = createRegistry();

export function registerVerb(verb: Verb): void {
  registry.register(verb);
}
