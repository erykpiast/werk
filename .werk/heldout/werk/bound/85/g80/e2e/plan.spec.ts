/** Held-out step 82.1: a plan over a decided subtree, seen on the board and the map, and the ✓ on each ghost. */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test } from '../../../e2e/harness.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const PLAN = '.werk/plans/auth'
const SPEC = ['# Spec', '', '## User Stories', '', '1. As a person, I log in, so that I see my map.', '2. As a person, I log out, so that I leave.', ''].join('\n')
const ticket = (title: string, cites: string, stories: string) =>
  [`title: ${title}`, `cites: ${cites}`, 'blocked_by:', `stories: ${stories}`, 'touches: session', '', '## What to build', '', `A person can ${title.toLowerCase()}.`, '',
    '## Acceptance criteria', '', '- [ ] It works.', '', '## Checks', '', '- `make test`', ''].join('\n')
const edit = (path: string, content: string) => ({ edit: { path, content } })

test('82.1 a plan records a feature run, writes tickets, and proposes the writers answers as ghosts the person accepts one at a time', async ({ page, werk }) => {
  // Setup: a decided subtree under "#auth", added to the fixture log.
  const log = join(werk.dir, '.werk', 'log.jsonl')
  const seq0 = readFileSync(log, 'utf8').trim().split('\n').length
  const at = '2026-10-21T03:00:00.000Z'
  const events = [
    { actor: 'agent', type: 'node.proposed', payload: { id: 'auth', kind: 'card', title: 'Sign in with a token', status: 'decided', who: 'you' } },
    { actor: 'you', type: 'node.accepted', payload: { id: 'auth' } },
    { actor: 'agent', type: 'node.proposed', payload: { id: 'auth-session', kind: 'card', title: 'Keep a session', status: 'decided', parent: 'auth' } },
    { actor: 'you', type: 'node.accepted', payload: { id: 'auth-session' } },
  ]
  appendFileSync(log, events.map((e, i) => JSON.stringify({ seq: seq0 + i + 1, at, ...e })).join('\n') + '\n')

  const root = dirname(werk.dir)
  writeFileSync(join(root, 'agent-script.json'), JSON.stringify({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify([
        { slug: 'token-ttl', title: 'A token lives one hour', why: 'How long does a token live?', body: 'One hour, then a new login.' }]))] },
      'ticket-writer': { steps: [
        edit(`${PLAN}/tickets/11-login.md`, ticket('Log in', 'auth', '1')),
        edit(`${PLAN}/tickets/12-logout.md`, ticket('Log out', 'auth-session', '2')),
        edit(`${PLAN}/tickets.answers.json`, JSON.stringify([
          { slug: 'split-login', title: 'Split login from logout', why: 'Is login one ticket or two?', body: 'Two tickets.' }])),
      ] },
    },
  }))
  const boardFile = join(werk.dir, '.werk', 'board.jsonl')
  const boardBefore = readFileSync(boardFile, 'utf8').trim().split('\n').length
  const env = {
    PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    WERK_FAKE_AGENT_SCRIPT: join(root, 'agent-script.json'),
  }
  const r = spawnSync('bun', [MAIN, 'plan', 'auth'], { cwd: werk.dir, env, encoding: 'utf8' })
  expect(r.stderr, r.stdout).toBe("")
  expect(r.status, r.stdout).toBe(0)

  const runEvents = readFileSync(boardFile, 'utf8').trim().split('\n').slice(boardBefore).map((l) => JSON.parse(l))
  expect(runEvents[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })

  // The board shows the two tickets.
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('li[data-ticket]').filter({ hasText: 'Log in' })).toHaveCount(1)
  await expect(page.locator('li[data-ticket]').filter({ hasText: 'Log out' })).toHaveCount(1)

  // The map shows each answer as a ghost under "#auth".
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  const authTile = page.getByRole('list', { name: 'map' }).locator('li[data-card-id="auth"]')
  for (const [id, title, why, body] of [
    ['auth-token-ttl', 'A token lives one hour', 'How long does a token live?', 'One hour, then a new login.'],
    ['auth-split-login', 'Split login from logout', 'Is login one ticket or two?', 'Two tickets.'],
  ] as const) {
    const tile = authTile.locator(`li[data-card-id="${id}"]`)
    await expect(tile).toHaveAttribute('data-proposed', 'true')
    await expect(tile.locator('a.ghost')).toBeVisible()
    const show = spawnSync('bun', [MAIN, 'show', id], { cwd: werk.dir, env, encoding: 'utf8' }).stdout
    expect(show).toContain('parent: #auth')
    // The plan writes who "me": the agent's own name for itself (the contract hint says --who you is the person).
    expect(show).toMatch(/^who: me$/m)
    await tile.locator('a').first().click()
    const card = page.getByTestId('card')
    await expect(card).toHaveAttribute('data-card-id', id)
    await expect(card.getByRole('heading', { level: 1 })).toHaveText(title)
    await expect(card).toContainText(why)
    await expect(card).toContainText(body)
    await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  }

  // The person accepts each ghost with the ✓, one at a time.
  await page.goto(`${werk.url}#auth-token-ttl`)
  await page.getByRole('button', { name: 'Accept #auth-token-ttl' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#auth-split-login`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'true')
  await page.getByRole('button', { name: 'Accept #auth-split-login' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
})
