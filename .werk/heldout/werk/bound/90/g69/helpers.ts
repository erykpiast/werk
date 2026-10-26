/** Helpers for the held-out browser specs of steps 69–72. */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Werk } from '../../e2e/harness.ts'

export const card = (id: string) => `li[data-card-id="${id}"]`

export type LogLine = { seq: number; type: string; actor: string; payload: Record<string, unknown> }

export const logLines = (werk: Werk): LogLine[] =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogLine)

/** Appends raw events to the project's log, as a map that already holds them. */
export function seed(werk: Werk, events: { type: string; payload: Record<string, unknown>; actor?: string }[]) {
  let seq = logLines(werk).at(-1)?.seq ?? 0
  const at = new Date().toISOString()
  appendFileSync(
    join(werk.dir, '.werk', 'log.jsonl'),
    events.map((e) => JSON.stringify({ seq: ++seq, at, actor: e.actor ?? 'agent', type: e.type, payload: e.payload }) + '\n').join(''),
  )
}

/** A real card, proposed and accepted, with optional fields. */
export const realCard = (id: string, title: string, fields: Record<string, unknown> = {}) => [
  { type: 'node.proposed', payload: { id, kind: 'card', title, ...fields } },
  { type: 'node.accepted', payload: { id }, actor: 'you' },
]

export const dependsOn = (from: string, to: string) => ({ type: 'edge.linked', payload: { from, to, type: 'depends_on' } })
export const refines = (from: string, to: string) => ({ type: 'edge.linked', payload: { from, to, type: 'refines' } })
