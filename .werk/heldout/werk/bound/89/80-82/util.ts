import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { logOf } from '../../src/test/map-events.ts'
import type { NewEvent } from '../../src/map/events.ts'
import type { BoardEvent } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'

export const FIX = join(import.meta.dir, 'fixtures')

/** A temp project whose map log holds the given events. */
export function projectWith(events: NewEvent[]): Project {
  const p = makeProject()
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), logOf(...events).map((e) => JSON.stringify(e)).join('\n') + '\n')
  return p
}

/** Copies one of my fixture folders and a spec into the project as tickets/ and spec.md. */
export function copyTickets(p: Project, folder: string, spec: string) {
  cpSync(join(FIX, folder), join(p.dir, 'tickets'), { recursive: true })
  cpSync(join(FIX, spec), join(p.dir, 'spec.md'))
}

export const ticketPath = (p: Project, name: string) => join(p.dir, 'tickets', name)
export const readTicket = (p: Project, name: string) => readFileSync(ticketPath(p, name), 'utf8')
export const writeTicket = (p: Project, name: string, text: string) => writeFileSync(ticketPath(p, name), text)

export const ticketCheck = (p: Project, root = 'map') => p.werk(['ticket-check', 'tickets', '--root', root, '--spec', 'spec.md'])

export const boardOf = (p: Project) => foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
export const boardLog = (p: Project) => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
