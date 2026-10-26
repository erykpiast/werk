// Fixture for the plan steps: a temp git repo with a decided map, the scripted fake agent
// (src/testing/fake-claude.ts, FAKE_CLAUDE_SCRIPT rules) first on PATH, and the real CLI.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLI, REPO, writeCards, type Card } from './helpers.ts'

const FAKE = join(REPO, 'src', 'testing', 'fake-claude.ts')

export type PlanProject = { dir: string; log: string; board: string; bin: string; script: string }

export function planProject(cards: Card[]): PlanProject {
  const dir = mkdtempSync(join(tmpdir(), 'werk-heldout-plan-'))
  const g = (...a: string[]) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.name', 'Test')
  g('config', 'user.email', 'test@example.com')
  writeFileSync(join(dir, '.gitignore'), '.werk/\n')
  writeFileSync(join(dir, 'README.md'), 'test repo\n')
  g('add', '-A')
  g('commit', '-q', '-m', 'initial')
  const log = join(dir, '.werk', 'log.jsonl')
  writeCards(log, cards.map((c) => ({ status: 'decided', who: 'me', noBasis: true, body: c.body ?? `Body of ${c.id}.`, ...c })))
  const bin = join(dir, 'fakebin')
  mkdirSync(bin)
  const shim = join(bin, 'claude')
  writeFileSync(shim, `#!/bin/sh\nexec bun ${JSON.stringify(FAKE)} "$@"\n`)
  chmodSync(shim, 0o755)
  return { dir, log, board: join(dir, '.werk', 'board.jsonl'), bin, script: join(bin, 'script.json') }
}

/** Set the rules the fake agent plays for the next run. */
export function script(p: PlanProject, rules: object[]) {
  for (const f of [`${p.script}.state.json`]) rmSync(f, { force: true })
  writeFileSync(p.script, JSON.stringify({ rules }))
}

export function werk(p: PlanProject, args: string[]) {
  const r = spawnSync('bun', [CLI, ...args], {
    cwd: p.dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      WERK_LOG: p.log,
      WERK_BOARD: p.board,
      WERK_PIPELINE: join(p.dir, '.werk', 'pipeline.jsonl'),
      PATH: `${p.bin}:${process.env.PATH}`,
      FAKE_CLAUDE_SCRIPT: p.script,
    },
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** `werk ticket list --run <run>` parsed into column -> ticket ids. */
export function ticketColumns(p: PlanProject, run: string): { text: string; cols: Record<string, string[]> } {
  const r = werk(p, ['ticket', 'list', '--run', run])
  const cols: Record<string, string[]> = {}
  let cur = ''
  for (const line of r.stdout.split('\n')) {
    const h = line.match(/^(\w+) \(\d+\)$/)
    if (h) {
      cur = h[1]
      cols[cur] = []
      continue
    }
    const t = line.match(/^\s+(\S+)\s/)
    if (t && cur) cols[cur].push(t[1])
  }
  return { text: r.stdout + r.stderr, cols }
}

export const read = (p: PlanProject, rel: string) => (existsSync(join(p.dir, rel)) ? readFileSync(join(p.dir, rel), 'utf8') : '')

export const spec = (stories: number) => `## Problem Statement

Shoppers lose track of what they want to buy.

## Solution

A shopping list they can see and add to.

## User Stories

${Array.from({ length: stories }, (_, i) => `${i + 1}. As a shopper, I want feature ${i + 1}, so that I keep track.`).join('\n')}

## Implementation Decisions

One list module (#shop).

## Testing Decisions

Test at the command line.

## Out of Scope

Sync between devices.

## Further Notes

None.
`

export const ticket = (o: { title: string; cites: string; blocked?: string; stories: string; what?: string; noAcceptance?: boolean }) => `title: ${o.title}
cites: ${o.cites}
blocked_by: ${o.blocked ?? ''}
stories: ${o.stories}

## What to build

${o.what ?? `${o.title}, end to end.`}
${o.noAcceptance ? '' : `
## Acceptance criteria

- [ ] It works for the shopper
`}
## Checks

- \`make test\`
- \`make typecheck\`
`

export const SUBTREE: Card[] = [
  { id: 'root', title: 'Root' },
  { id: 'shop', title: 'Shopping list', parent: 'root', body: 'The list. See #ext.' },
  { id: 'a', title: 'Add an item', parent: 'shop', dependsOn: ['b'] },
  { id: 'b', title: 'Items are stored', parent: 'shop' },
  { id: 'ext', title: 'Linked outside card' },
]
