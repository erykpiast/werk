import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Werk } from '../../e2e/harness.ts'

export const card = (id: string) => `li[data-card-id="${id}"]`

export const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

/** Adds a card and accepts it, the way the person asks for it. */
export function real(werk: Werk, id: string, title: string, extra: string[] = []) {
  werk.cli(['add', id, '--title', title, ...extra])
  werk.cli(['accept', id, '--actor', 'you'])
}

export function appendBoard(werk: Werk, events: { type: string; payload: unknown; actor?: string }[]) {
  const path = join(werk.dir, '.werk', 'board.jsonl')
  const lines = readFileSync(path, 'utf8').trim().split('\n')
  let seq = (JSON.parse(lines.at(-1)!) as { seq: number }).seq
  for (const e of events) {
    seq++
    appendFileSync(path, JSON.stringify({ seq, at: new Date().toISOString(), actor: e.actor ?? 'agent', type: e.type, payload: e.payload }) + '\n')
  }
}
