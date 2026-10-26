/**
 * The verb registry (#werk-verb-registry). A verb lives in its own module under src/verbs/
 * and calls `registerVerb` when it loads. The command line imports every module in that
 * folder, so a new verb edits no shared list, and the help text reads its verb list from
 * what registered.
 */
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Flags = Record<string, string | true>

export type VerbContext = {
  positional: string[]
  flags: Flags
  actor: 'you' | 'agent'
}

export type Verb = {
  name: string
  /** One line for the help text: the form of the verb, then what it does. */
  summary: string
  /** Returns the lines to print. Throws an Error whose message is the refusal. */
  run: (ctx: VerbContext) => string[] | Promise<string[]>
}

const verbs = new Map<string, Verb>()

export function registerVerb(verb: Verb): void {
  if (verbs.has(verb.name)) throw new Error(`verb "${verb.name}" is registered twice`)
  verbs.set(verb.name, verb)
}

/** Import every verb module in `dir`, so each one registers itself. Safe to call twice. */
export async function loadVerbs(dir = join(dirname(fileURLToPath(import.meta.url)), 'verbs')): Promise<void> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
  for (const f of files) await import(join(dir, f))
}

export function findVerb(name: string): Verb | undefined {
  return verbs.get(name)
}

/** The registered verbs, by name. */
export function registeredVerbs(): Verb[] {
  return [...verbs.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The help text's verb list: one line per registered verb. */
export function verbHelp(): string {
  return registeredVerbs()
    .map((v) => `  werk ${v.summary}`)
    .join('\n')
}
