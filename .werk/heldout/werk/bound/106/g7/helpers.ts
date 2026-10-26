/** Shared setup for the g7 held-out browser tests. */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Page } from '@playwright/test'

export const MAIN = join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts')

/** The environment e2e/harness.ts gives every process it starts, rebuilt from the project path. */
export function envOf(dir: string): Record<string, string> {
  const root = dirname(dir)
  return {
    PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
    HOME: root,
    TMPDIR: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    WERK_FAKE_AGENT_SCRIPT: join(root, 'agent-script.json'),
    WERK_FAKE_AGENT_LOG: join(root, 'agent-launches.jsonl'),
    WERK_FAKE_AGENT_INPUT: join(root, 'agent-input.jsonl'),
  }
}

/** Runs werk in the project and returns its exit code and output, whatever the code. */
export function werkRun(dir: string, args: string[]) {
  const r = spawnSync('bun', [MAIN, ...args], { cwd: dir, env: envOf(dir), encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

export const readJsonl = <T = Record<string, unknown>>(path: string): T[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T)

/** Appends map events to the project's log with the next sequence numbers. */
export function appendMap(dir: string, events: { type: string; payload: unknown; actor?: string }[]) {
  const path = join(dir, '.werk', 'log.jsonl')
  let seq = (readJsonl<{ seq: number }>(path).at(-1)?.seq ?? 0) + 1
  for (const e of events) {
    appendFileSync(path, JSON.stringify({ seq: seq++, at: new Date().toISOString(), actor: e.actor ?? 'agent', type: e.type, payload: e.payload }) + '\n')
  }
}

/** Appends board events with the next sequence numbers. */
export function appendBoard(dir: string, events: { type: string; payload: unknown; actor?: string }[]) {
  const path = join(dir, '.werk', 'board.jsonl')
  let seq = (readJsonl<{ seq: number }>(path).at(-1)?.seq ?? 0) + 1
  for (const e of events) {
    appendFileSync(path, JSON.stringify({ seq: seq++, at: new Date().toISOString(), actor: e.actor ?? 'agent', type: e.type, payload: e.payload }) + '\n')
  }
}

/** A real decided card. */
export const decidedCard = (id: string, parent?: string) => [
  { type: 'node.proposed', payload: { id, kind: 'card', title: `The ${id} card`, status: 'decided', who: 'you', ...(parent && { parent }) } },
  { type: 'node.accepted', payload: { id }, actor: 'you' },
]

export const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
export const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

export async function openBoard(page: Page) {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
