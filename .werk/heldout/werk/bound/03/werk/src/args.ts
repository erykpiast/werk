/** The command line, parsed. A pure function: argv in, a command or an error out. */
import { KINDS, LINK_TYPES, WHOS, type EventBody, type RecordedFact, type Field, type Kind, type LinkType, type Who } from './map/events.ts'

export const DEFAULT_PORT = 4747

export type Command =
  | { kind: 'serve'; port: number }
  /** A command that writes the map appends exactly one event (#pr-log). */
  | { kind: 'write'; event: EventBody }
  | { kind: 'show'; id: string | undefined }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

export const USAGE = `usage: werk <command>

commands:
  serve [--port <n>]                    serve the map of the project in the current directory
  show [<id>]                           print the page of a card, or the root page, as JSON
  add <id> --title <t> [--kind card|option|source] [--why <w>] [--body <b>]
           [--why-not <w>] [--parent <id>] [--alternative-to <id>] [--who you|me|prototype]
                                        with --parent, the card refines it; with
                                        --alternative-to, the option is weighed against it
  link <from> <to> --type refines|depends_on|supported_by|alternative_to [--why <w>]
  retitle <id> <title>
  edit <id> --body|--why|--why-not <text>
  edit <id> --who you|me|prototype      who decides the card
  edit <id> --no-basis <reason>         the card needs no depends_on target and no decided parent
  edit <id> --unchallenged <reason>     no option was weighed against the card
  kill <id> <criterion>                 add one kill criterion: what must become true to revisit it
  decide <id>                           runs the decide check first; a failure prints the fix
  reopen <id> --why <w>
  status <id> decided|open [--why <w>]  the same as decide, or reopen with its --why
  remove <id>
  restore <id>
  say <id> <text> --who <name>          a verbatim excerpt, attributed
  dispute <source> --why <w>            flag every card the source supports for review
  help                                  print this text

every command that writes appends exactly one event to .werk/log.jsonl`

type Parsed = { args: string[]; flags: Record<string, string> }

/** Splits the words after the verb into positional args and `--flag value` pairs. */
function split(verb: string, rest: readonly string[], allowed: readonly string[]): Parsed | string {
  const args: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]!
    if (!word.startsWith('--')) {
      args.push(word)
      continue
    }
    const name = word.slice(2)
    if (!allowed.includes(name)) return `${verb}: unknown option: ${word}`
    const value = rest[++i]
    if (value === undefined) return `${verb}: ${word} needs a value`
    flags[name] = value
  }
  return { args, flags }
}

type Spec = { args: number; flags?: readonly string[]; required?: readonly string[]; build: (p: Parsed) => EventBody | string }

const FIELD_FLAGS: Record<string, Field> = { body: 'body', why: 'why', 'why-not': 'whyNot' }
const FACT_FLAGS: Record<string, RecordedFact> = { who: 'who', 'no-basis': 'noBasis', unchallenged: 'unchallenged' }
const badWho = (verb: string, who: string) => `${verb}: --who is one of ${WHOS.join(', ')}, got ${who}`

const WRITES: Record<string, Spec> = {
  add: {
    args: 1,
    flags: ['title', 'kind', 'why', 'body', 'why-not', 'parent', 'alternative-to', 'who'],
    required: ['title'],
    build: ({ args: [id], flags }) => {
      const kind = (flags.kind ?? 'card') as Kind
      if (!KINDS.includes(kind)) return `add: --kind is one of ${KINDS.join(', ')}, got ${kind}`
      if (flags.who !== undefined && !WHOS.includes(flags.who as Who)) return badWho('add', flags.who)
      const added: EventBody = { type: 'added', id: id!, kind, title: flags.title! }
      if (flags.why !== undefined) added.why = flags.why
      if (flags.body !== undefined) added.body = flags.body
      if (flags['why-not'] !== undefined) added.whyNot = flags['why-not']
      if (flags.parent !== undefined) added.parent = flags.parent
      if (flags['alternative-to'] !== undefined) added.alternativeTo = flags['alternative-to']
      if (flags.who !== undefined) added.who = flags.who as Who
      return added
    },
  },
  link: {
    args: 2,
    flags: ['type', 'why'],
    required: ['type'],
    build: ({ args: [from, to], flags }) => {
      const link = flags.type as LinkType
      if (!LINK_TYPES.includes(link)) return `link: --type is one of ${LINK_TYPES.join(', ')}, got ${link}`
      return flags.why === undefined ? { type: 'linked', from: from!, to: to!, link } : { type: 'linked', from: from!, to: to!, link, why: flags.why }
    },
  },
  retitle: { args: 2, build: ({ args: [id, title] }) => ({ type: 'retitled', id: id!, title: title! }) },
  edit: {
    args: 1,
    flags: [...Object.keys(FIELD_FLAGS), ...Object.keys(FACT_FLAGS)],
    build: ({ args: [id], flags }) => {
      const given = Object.keys(flags)
      if (given.length !== 1) return `edit: give exactly one of --body, --why, --why-not, --who, --no-basis, --unchallenged`
      const [flag] = given as [string]
      const fact = FACT_FLAGS[flag]
      if (fact === undefined) return { type: 'edited', id: id!, field: FIELD_FLAGS[flag]!, text: flags[flag]! }
      if (fact === 'who' && !WHOS.includes(flags[flag] as Who)) return badWho('edit', flags[flag]!)
      return { type: 'recorded', id: id!, fact, value: flags[flag]! }
    },
  },
  kill: { args: 2, build: ({ args: [id, text] }) => ({ type: 'killAdded', id: id!, text: text! }) },
  decide: { args: 1, build: ({ args: [id] }) => ({ type: 'decided', id: id! }) },
  reopen: { args: 1, flags: ['why'], required: ['why'], build: ({ args: [id], flags }) => ({ type: 'reopened', id: id!, why: flags.why! }) },
  status: {
    args: 2,
    flags: ['why'],
    build: ({ args: [id, status], flags }) => {
      if (status === 'decided') return flags.why === undefined ? { type: 'decided', id: id! } : 'status: decided takes no --why'
      if (status === 'open') return flags.why === undefined ? 'status: open needs --why' : { type: 'reopened', id: id!, why: flags.why }
      return `status: is decided or open, got ${status}`
    },
  },
  remove: { args: 1, build: ({ args: [id] }) => ({ type: 'removed', id: id! }) },
  restore: { args: 1, build: ({ args: [id] }) => ({ type: 'restored', id: id! }) },
  say: { args: 2, flags: ['who'], required: ['who'], build: ({ args: [id, text], flags }) => ({ type: 'said', id: id!, who: flags.who!, text: text! }) },
  dispute: { args: 1, flags: ['why'], required: ['why'], build: ({ args: [id], flags }) => ({ type: 'disputed', id: id!, why: flags.why! }) },
}

export function parseArgs(argv: readonly string[]): Command {
  const [verb, ...rest] = argv
  if (verb === undefined || verb === 'help' || verb === '--help' || verb === '-h') return { kind: 'help' }
  if (verb === 'serve') return parseServe(rest)
  if (verb === 'show') {
    const parsed = split(verb, rest, [])
    if (typeof parsed === 'string') return { kind: 'error', message: parsed }
    if (parsed.args.length > 1) return { kind: 'error', message: 'show: takes at most one card id' }
    return { kind: 'show', id: parsed.args[0] }
  }
  const spec = WRITES[verb]
  if (!spec) return { kind: 'error', message: `unknown command: ${verb}` }
  const parsed = split(verb, rest, spec.flags ?? [])
  if (typeof parsed === 'string') return { kind: 'error', message: parsed }
  if (parsed.args.length !== spec.args) return { kind: 'error', message: `${verb}: needs ${spec.args} argument(s), got ${parsed.args.length}` }
  const missing = (spec.required ?? []).find((flag) => parsed.flags[flag] === undefined)
  if (missing) return { kind: 'error', message: `${verb}: --${missing} is required` }
  const event = spec.build(parsed)
  return typeof event === 'string' ? { kind: 'error', message: event } : { kind: 'write', event }
}

function parseServe(rest: readonly string[]): Command {
  let port = DEFAULT_PORT
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg !== '--port') return { kind: 'error', message: `serve: unknown option: ${arg}` }
    const value = rest[++i]
    const n = Number(value)
    if (value === undefined || value === '' || !Number.isInteger(n) || n < 0 || n > 65535) {
      return { kind: 'error', message: `serve: --port needs a port number from 0 to 65535, got ${value ?? 'nothing'}` }
    }
    port = n
  }
  return { kind: 'serve', port }
}
