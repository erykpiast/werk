/**
 * `werk ticket <verb>`: the agent's side of the board (#werk-board-control). A person drags;
 * an agent moves a ticket between blocked and ready with a reason, archives or restores it,
 * and imports a plan run's ticket files onto the board.
 *
 * Returns the lines to print. Throws an Error whose message is the refusal.
 */
import { agentMove, appendBoard, canArchive, columns, COLUMNS, foldBoard, readBoard, type Ticket } from './board.ts'
import { plannedFromRun, plannedIds } from './board-text.ts'
import { readRun } from './board-files.ts'
import { paths as project } from './project.ts'

type Flags = Record<string, string | true>

const str = (flags: Flags, name: string) => (typeof flags[name] === 'string' ? (flags[name] as string) : undefined)

function line(t: Ticket): string {
  const marks = [
    t.live ? 'live' : '',
    t.passes > 1 ? `${t.passes - 1} retr${t.passes - 1 === 1 ? 'y' : 'ies'}` : '',
    t.openBlockers.length ? `blocked by ${t.openBlockers.join(', ')}` : '',
    t.heldOutRed ? `held-out red${t.followUp ? ` → ${t.followUp}` : ''}` : '',
    t.archived ? 'archived' : '',
  ].filter(Boolean)
  return `  ${t.id.padEnd(24)} ${t.title}${marks.length ? `  [${marks.join('; ')}]` : ''}`
}

export function ticketCommand(
  positional: string[],
  flags: Flags,
  actor: 'you' | 'agent',
  paths: { board?: string; tickets?: string } = {},
): string[] {
  const boardPath = paths.board ?? project.board
  const ticketsDir = paths.tickets ?? project.tickets
  const [verb, id, to] = positional
  const board = () => foldBoard(readBoard(boardPath))
  const find = (ticketId: string | undefined) => {
    if (!ticketId) throw new Error(`ticket ${verb} needs a ticket id`)
    // A card id takes a leading #, so a ticket id does too. A bare number that exactly one
    // archived ticket ends in names that ticket; more than one is ambiguous (restore only).
    const key = ticketId.replace(/^#/, '')
    let t = board().tickets.get(key)
    if (!t && verb === 'restore' && /^\d+$/.test(key)) {
      const hits = [...board().tickets.values()].filter((x) => x.archived && x.id.endsWith(`/${key}`))
      if (hits.length > 1) throw new Error(`"${key}" fits ${hits.length} archived tickets: ${hits.map((x) => x.id).join(', ')}. Give the full id.`)
      t = hits[0]
    }
    if (!t) throw new Error(`no ticket with the id "${ticketId}". Run "werk ticket list".`)
    return t
  }

  switch (verb) {
    case 'list': {
      const run = str(flags, 'run')
      const b = board()
      const cols = columns(b)
      const out: string[] = []
      for (const c of COLUMNS) {
        const ts = cols[c].filter((t) => !run || t.run === run)
        out.push(`${c} (${ts.length})`, ...ts.map(line))
      }
      const archived = [...b.tickets.values()].filter((t) => t.archived && (!run || t.run === run))
      if (archived.length) out.push(`archived (${archived.length})`, ...archived.map(line))
      return out
    }
    case 'move': {
      const t = find(id)
      if (to !== 'blocked' && to !== 'ready') throw new Error('ticket move takes blocked or ready')
      const reason = str(flags, 'reason')
      const ok = agentMove(t, to, reason)
      if (!ok.ok) throw new Error(ok.why)
      appendBoard('ticket.moved', { id: t.id, to, reason: reason!.trim() }, { actor, path: boardPath })
      return [`${t.id} is in ${to}`]
    }
    case 'archive': {
      const t = find(id)
      if (!canArchive(t)) throw new Error(`${t.id} is in ${t.column}${t.archived ? ' and already archived' : ''}; only a ready, blocked or building ticket is archived`)
      // #werk-board-control-archive-ends-build: no signal. The builder loop of a building ticket
      // reads the board and ends its own build; the branch stays.
      appendBoard('ticket.archived', { id: t.id }, { actor, path: boardPath })
      return [`${t.id} archived from ${t.column}`]
    }
    case 'restore': {
      const t = find(id)
      if (!t.archived) throw new Error(`${t.id} is not archived`)
      appendBoard('ticket.restored', { id: t.id }, { actor, path: boardPath })
      return [`${t.id} is in ${t.column}`]
    }
    case 'import': {
      const run = id ?? (() => { throw new Error('ticket import needs a plan run id') })()
      const files = readRun(run, ticketsDir)
      if (!files) throw new Error(`no ticket files in ${ticketsDir}/${run}`)
      // #st-ticket-partial: a ticket that fails its own checks stays off the board.
      const { planned, failed } = plannedFromRun(run, files, plannedIds(readBoard(boardPath)))
      for (const p of planned) appendBoard('ticket.planned', p, { actor, path: boardPath })
      const already = files.length - planned.length - failed.length
      return [
        `imported ${planned.length} of ${files.length} ticket(s) from ${run}${already ? `, ${already} on the board already` : ''}${failed.length ? `, ${failed.length} failed their own checks` : ''}`,
        ...failed.map((f) => `  ${f.name}: ${f.failures.join('; ')}`),
      ]
    }
    default:
      throw new Error(`unknown ticket verb "${verb ?? ''}". Use list, move, archive, restore, or import.`)
  }
}
