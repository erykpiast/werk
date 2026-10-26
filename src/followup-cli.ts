/**
 * `werk followup <ticket>`: the chat agent's record of a request to change the work of a done
 * ticket (#werk-cli-followup, #ms-outcome-followup). It writes one board event, or lists the
 * ticket's records with their corrections in force.
 *
 * Returns the lines to print. Throws an Error whose message is the refusal.
 */
import { appendBoard, foldBoard, readBoard, type FollowUpClass, type FollowUpFound } from './board.ts'
import { followUps, type FollowUp } from './outcomes.ts'
import { paths as project } from './project.ts'

type Flags = Record<string, string | true>

const str = (flags: Flags, name: string) => (typeof flags[name] === 'string' ? (flags[name] as string) : undefined)

const CLASSES: FollowUpClass[] = ['plan', 'build']
const FOUND: FollowUpFound[] = ['review', 'after-merge']

const line = (f: FollowUp) =>
  `  ${f.n}. ${f.class} miss, found ${f.found}${f.catchable === undefined ? '' : f.catchable ? ', a check could catch it' : ', no check could catch it'}` +
  `${f.corrected ? ` (corrected ${f.corrected}x)` : ''} — ${f.why}`

export function followupCommand(positional: string[], flags: Flags, actor: 'you' | 'agent', paths: { board?: string } = {}): string[] {
  const boardPath = paths.board ?? project.board
  const id = positional[0]
  if (!id) throw new Error('followup needs a ticket id')
  const events = readBoard(boardPath)
  const t = foldBoard(events).tickets.get(id)
  if (!t) throw new Error(`no ticket "${id}". Run "werk ticket list" to see the board.`)
  const records = followUps(events).filter((f) => f.ticket === id)
  if (flags.list) return records.length ? [`${id} — ${t.title}`, ...records.map(line)] : [`${id} has no follow-up`]

  if (t.column !== 'done') throw new Error(`${id} is in ${t.column}, not done: a follow-up is a request after a finished build`)
  const cls = str(flags, 'class') as FollowUpClass | undefined
  if (!cls || !CLASSES.includes(cls)) throw new Error('--class must be plan or build')
  const found = str(flags, 'found') as FollowUpFound | undefined
  if (!found || !FOUND.includes(found)) throw new Error('--found must be review or after-merge')
  const why = str(flags, 'why')
  if (!why) throw new Error('--why needs one line: what the person asked for, and why it is this class')
  const catchableFlag = str(flags, 'catchable')
  if (cls === 'plan' && catchableFlag !== undefined) throw new Error('--catchable is for a build miss only: a plan miss has no defect a check could catch')
  if (cls === 'build' && catchableFlag !== 'yes' && catchableFlag !== 'no') throw new Error('a build miss needs --catchable yes|no: could a check have caught it?')
  const ofFlag = str(flags, 'of')
  const of = ofFlag === undefined ? undefined : Number(ofFlag)
  if (of !== undefined && !(Number.isInteger(of) && of >= 1 && of <= records.length)) {
    throw new Error(`--of must name one of ${id}'s records, 1 to ${records.length}. Run "werk followup ${id} --list".`)
  }

  appendBoard(
    'ticket.followup',
    { id, class: cls, found, why, ...(cls === 'build' ? { catchable: catchableFlag === 'yes' } : {}), ...(of !== undefined ? { of } : {}) },
    { actor, path: boardPath },
  )
  const after = followUps(readBoard(boardPath)).filter((f) => f.ticket === id)
  const shown = after[(of ?? after.length) - 1]
  return [`${of !== undefined ? 'corrected' : 'recorded'} follow-up on ${id}:`, line(shown)]
}
