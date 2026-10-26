/**
 * The ticket files on disk: .werk/tickets/<run>/<NN>.md (#st-ticket). The I/O half of
 * board-text.ts, which parses what these functions read.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { Ticket } from './board.ts'
import { isRunId, isTicketId, parseTicketText, type TicketText } from './board-text.ts'
import { paths, projectRoot } from './project.ts'

/** One run's ticket files, with the path stored relative to cwd when it lies under it. */
export function readRun(run: string, dir = paths.tickets, cwd = projectRoot()) {
  if (!isRunId(run)) throw new Error(`not a plan run id: ${JSON.stringify(run)} (a plain name, no slash, no leading dot)`)
  const runDir = join(dir, run)
  if (!existsSync(runDir)) return undefined
  return readdirSync(runDir)
    .filter((f) => /^\d+\.md$/.test(f))
    .map((name) => {
      const abs = join(runDir, name)
      const rel = relative(cwd, abs)
      return { name, path: rel.startsWith('..') || isAbsolute(rel) ? abs : rel, text: readFileSync(abs, 'utf8') }
    })
}

/** The file a ticket's text is in: its planned path, else <dir>/<run>/<NN>.md — the second
 *  only for an id of that shape, so an id never names a path outside <dir>. */
export function ticketPath(t: Pick<Ticket, 'id' | 'file'>, dir = paths.tickets, cwd = projectRoot()): string | undefined {
  const candidates = [t.file ? (isAbsolute(t.file) ? t.file : join(cwd, t.file)) : undefined, isTicketId(t.id) ? join(dir, `${t.id}.md`) : undefined]
  return candidates.find((p): p is string => !!p && existsSync(p))
}

export function readTicketText(t: Pick<Ticket, 'id' | 'file'>, dir = paths.tickets, cwd = projectRoot()): TicketText | undefined {
  const path = ticketPath(t, dir, cwd)
  return path ? parseTicketText(readFileSync(path, 'utf8')) : undefined
}
