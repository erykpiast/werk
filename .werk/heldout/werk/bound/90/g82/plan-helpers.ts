/** Shared setup for the plan steps: a decided subtree under #auth, and scripted writers. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { Event } from '../../src/map/events.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import type { Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

export const PLAN = '.werk/plans/auth'

export const SPEC = `# Spec: sign in

## Problem Statement

A person cannot sign in.

## User Stories

1. As a person, I want to log in, so that I see my map.
2. As a person, I want to log out, so that I leave a shared machine.

## Implementation Decisions

1. Not a story.
`

/** The map: #auth decided, with decided children auth-session and auth-logout. */
export function seedMap(p: Project, extra: ReturnType<typeof proposed>[] = []) {
  const log = logOf(
    proposed('auth', { status: 'decided', who: 'you', title: 'Auth' }),
    proposed('auth-session', { status: 'decided', parent: 'auth', title: 'Sessions' }),
    proposed('auth-logout', { status: 'decided', parent: 'auth', title: 'Logout' }),
    accepted('auth-session'),
    accepted('auth-logout'),
    ...extra.flatMap((e) => [e, accepted((e.payload as { id: string }).id)]),
  )
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

export const ticketText = (o: { title: string; cites: string; blockedBy?: string; stories?: string | null; touches?: string }) =>
  [
    `title: ${o.title}`,
    `cites: ${o.cites}`,
    `blocked_by: ${o.blockedBy ?? ''}`,
    ...(o.stories === null ? [] : [`stories: ${o.stories ?? '1'}`]),
    `touches: ${o.touches ?? 'auth flow'}`,
    '',
    '## What to build',
    '',
    `Build ${o.title}.`,
    '',
    '## Acceptance criteria',
    '',
    `- ${o.title} works.`,
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

export type Answer = { slug: string; title: string; why: string; body: string }
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })

export function scriptWriters(
  scriptAgent: (s: never) => void,
  tickets: Record<string, string>,
  answers: { spec?: Answer[]; tickets?: Answer[] } = {},
) {
  scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify(answers.spec ?? []))] },
      'ticket-writer': {
        steps: [
          ...Object.entries(tickets).map(([name, text]) => edit(`${PLAN}/tickets/${name}`, text)),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify(answers.tickets ?? [])),
        ],
      },
    },
  } as never)
}

export const mapLog = (dir: string) => readLog<Event>(join(dir, '.werk', 'log.jsonl'))
export const boardLog = (dir: string) => readLog<BoardEvent>(join(dir, '.werk', 'board.jsonl'))
export const boardTickets = (dir: string) =>
  foldBoard(boardLog(dir)).columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name as string, number: t.number, title: t.title })))

export const GOOD_TICKETS = {
  '01-login.md': ticketText({ title: 'login', cites: 'auth-session, #auth', stories: '1' }),
  '02-logout.md': ticketText({ title: 'logout', cites: 'auth-logout', stories: '2', touches: 'logout flow' }),
}
