/** The command line, parsed. A pure function: argv in, a command or an error out. */
import { KINDS, LINK_TYPES, REOPEN_REASONS, WHOS, type EventBody, type RecordedFact, type Field, type Kind, type LinkType, type ReopenReason, type Who } from './map/events.ts'
import { MARK_KINDS, type MarkKind } from './map/marks.ts'

export const DEFAULT_PORT = 4747

export type Command =
  | { kind: 'serve'; port: number }
  /** A command that writes the map appends exactly one event (#pr-log). */
  | { kind: 'write'; event: EventBody }
  | { kind: 'show'; id: string | undefined }
  /** Lists the marked cards in the subtree of `id`, or the whole map, of one kind or all. */
  | { kind: 'stale'; id: string | undefined; only: MarkKind | undefined }
  /** Finds `text` verbatim in the transcript of `session`, and proposes it as an excerpt that `cites` is supported_by. */
  | { kind: 'quote'; cites: string; session: string; text: string }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

export const USAGE = `usage: werk <command>

commands:
  serve [--port <n>]                    serve the map of the project in the current directory
  show [<id>]                           print the page of a card, or the root page, as JSON
  stale [<id>] [--kind stale|paused|review]
                                        list the marked cards, basis first, each mark with its trace
  add <id> --title <t> [--kind card|option|source|excerpt] [--why <w>] [--body <b>]
           [--why-not <w>] [--parent <id>] [--alternative-to <id>] [--who you|me|prototype]
                                        propose a ghost: it waits for the person's accept,
                                        and its words are frozen; with --parent, it refines
                                        that card; with --alternative-to, the option is
                                        weighed against it
  accept <id> --actor you               accept one ghost, its ghost parents, options and
                                        evidence; --actor you states the person asked for it
  discard <id>                          drop a ghost and the ghosts below it
  link <from> <to> --type refines|depends_on|supported_by|alternative_to [--why <w>]
  retitle <id> <title>
  edit <id> --body|--why|--why-not <text>
  edit <id> --who you|me|prototype      who decides the card
  edit <id> --no-basis <reason>         the card needs no depends_on target and no decided parent
  edit <id> --unchallenged <reason>     no option was weighed against the card
  kill <id> <criterion>                 add one kill criterion: what must become true to revisit it
  decide <id>                           runs the decide check first; a failure prints the fix
  reopen <id> --reason postponed|rejected --why <w>
                                        postponed pauses every card downstream; rejected
                                        marks the next hop stale. Deciding it again resumes
  status <id> decided|open [--reason <r> --why <w>]
                                        the same as decide, or reopen with its --reason and --why
  remove <id>
  restore <id>
  say <id> <text> --who <name>          a verbatim excerpt, attributed
  quote <id> <session> --text <t>       find the text verbatim in the session's transcript,
                                        and propose it as an excerpt that #<id> is supported_by;
                                        no exact match, or a match in two places, writes nothing
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
      const added: EventBody = { type: 'proposed', id: id!, kind, title: flags.title! }
      if (flags.why !== undefined) added.why = flags.why
      if (flags.body !== undefined) added.body = flags.body
      if (flags['why-not'] !== undefined) added.whyNot = flags['why-not']
      if (flags.parent !== undefined) added.parent = flags.parent
      if (flags['alternative-to'] !== undefined) added.alternativeTo = flags['alternative-to']
      if (flags.who !== undefined) added.who = flags.who as Who
      return added
    },
  },
  accept: {
    args: 1,
    flags: ['actor'],
    build: ({ args: [id], flags }) =>
      flags.actor === 'you'
        ? { type: 'accepted', id: id! }
        : 'accept: only the person accepts a proposal. Add --actor you only when the person asked for this accept; the ✓ in the map is the usual path',
  },
  discard: { args: 1, build: ({ args: [id] }) => ({ type: 'discarded', id: id! }) },
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
  reopen: { args: 1, flags: ['reason', 'why'], required: ['reason', 'why'], build: ({ args: [id], flags }) => reopened('reopen', id!, flags) },
  status: {
    args: 2,
    flags: ['reason', 'why'],
    build: ({ args: [id, status], flags }) => {
      if (status === 'decided') return Object.keys(flags).length === 0 ? { type: 'decided', id: id! } : 'status: decided takes no --reason or --why'
      if (status !== 'open') return `status: is decided or open, got ${status}`
      if (flags.reason === undefined || flags.why === undefined) return 'status: open needs --reason and --why'
      return reopened('status', id!, flags)
    },
  },
  remove: { args: 1, build: ({ args: [id] }) => ({ type: 'removed', id: id! }) },
  restore: { args: 1, build: ({ args: [id] }) => ({ type: 'restored', id: id! }) },
  say: { args: 2, flags: ['who'], required: ['who'], build: ({ args: [id, text], flags }) => ({ type: 'said', id: id!, who: flags.who!, text: text! }) },
  dispute: { args: 1, flags: ['why'], required: ['why'], build: ({ args: [id], flags }) => ({ type: 'disputed', id: id!, why: flags.why! }) },
}

/** A reopen always carries its reason (#pr-wf-paused). */
function reopened(verb: string, id: string, flags: Record<string, string>): EventBody | string {
  const reason = flags.reason as ReopenReason
  if (!REOPEN_REASONS.includes(reason)) return `${verb}: --reason is one of ${REOPEN_REASONS.join(', ')}, got ${reason}`
  return { type: 'reopened', id, reason, why: flags.why! }
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
  if (verb === 'stale') {
    const parsed = split(verb, rest, ['kind'])
    if (typeof parsed === 'string') return { kind: 'error', message: parsed }
    if (parsed.args.length > 1) return { kind: 'error', message: 'stale: takes at most one card id' }
    const only = parsed.flags.kind as MarkKind | undefined
    if (only !== undefined && !MARK_KINDS.includes(only)) return { kind: 'error', message: `stale: --kind is one of ${MARK_KINDS.join(', ')}, got ${only}` }
    return { kind: 'stale', id: parsed.args[0], only }
  }
  if (verb === 'quote') {
    const parsed = split(verb, rest, ['text'])
    if (typeof parsed === 'string') return { kind: 'error', message: parsed }
    if (parsed.args.length !== 2) return { kind: 'error', message: `quote: needs <card-id> <session>, got ${parsed.args.length} argument(s)` }
    if (parsed.flags.text === undefined) return { kind: 'error', message: 'quote: --text is required, copied verbatim from the transcript' }
    return { kind: 'quote', cites: parsed.args[0]!, session: parsed.args[1]!, text: parsed.flags.text }
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
