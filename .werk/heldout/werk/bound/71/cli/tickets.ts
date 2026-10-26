import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
import type { Project } from './helpers.ts'

export type T = { title: string; cites: string; blocked?: string; stories: string; touches?: string | null; what?: string; noWhatHeading?: boolean }

export const ticketText = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    `stories: ${t.stories}`,
    ...(t.touches === null ? [] : [`touches: ${t.touches ?? 'map view'}`]),
    '',
    ...(t.noWhatHeading ? [] : ['## What to build', '']),
    t.what ?? 'A person sees the change in the map.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The map shows the change.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

/** A map whose subtree under the open root "map" holds the given decided cards. */
export const writeMap = (p: Project, decided: string[]) => {
  const log = logOf(
    proposed('map', { status: 'open' }),
    ...decided.map((id) => proposed(id, { status: 'decided', parent: 'map' })),
    accepted('map'),
    ...decided.map((id) => accepted(id)),
  )
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

export const writeSpec = (p: Project, n: number) => {
  const stories = Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}, so that it works.`)
  writeFileSync(join(p.dir, 'spec.md'), ['# Spec', '', '## User Stories', '', ...stories, '', '## Implementation Decisions', '', 'None.', ''].join('\n'))
}

export const writeTickets = (p: Project, tickets: Record<string, T>, folder = 'tickets') => {
  mkdirSync(join(p.dir, folder), { recursive: true })
  for (const [name, t] of Object.entries(tickets)) writeFileSync(join(p.dir, folder, name), ticketText(t))
}

export const check = (p: Project, folder = 'tickets') => p.werk(['ticket-check', folder, '--root', 'map', '--spec', 'spec.md'])
