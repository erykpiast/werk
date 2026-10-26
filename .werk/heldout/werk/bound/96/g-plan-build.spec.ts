/** Held-out step 82.1, browser part: the person accepts each answer ghost with the ✓ button. */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../e2e/harness.ts'

const PLAN = '.werk/plans/auth'
const SPEC = '# Spec: auth\n\n## User Stories\n\n1. As a person, I want to log in.\n2. As a person, I want to log out.\n'
const ticket = (title: string, cites: string, stories: string) =>
  [`title: ${title}`, `cites: ${cites}`, 'blocked_by:', `stories: ${stories}`, 'touches: session store', '', '## What to build', '', `The ${title}.`, '', '## Acceptance criteria', '', `- [ ] The ${title} works.`, '', '## Checks', '', '- `make test`', ''].join('\n')
const edit = (path: string, content: string) => ({ edit: { path, content } })

test('82.1 a plan puts tickets on the board and its answers on the map as ghosts the person accepts with ✓ one at a time', async ({ page, werk }) => {
  const log = join(werk.dir, '.werk', 'log.jsonl')
  const last = readFileSync(log, 'utf8').trim().split('\n').length
  const at = '2026-10-22T00:00:00.000Z'
  const events = [
    { type: 'node.proposed', payload: { id: 'auth', kind: 'card', title: 'Auth', status: 'decided', who: 'you' } },
    { type: 'node.accepted', payload: { id: 'auth' } },
    { type: 'node.proposed', payload: { id: 'auth-session', kind: 'card', title: 'Sessions', status: 'decided', parent: 'auth' } },
    { type: 'node.accepted', payload: { id: 'auth-session' } },
  ]
  appendFileSync(log, events.map((e, i) => JSON.stringify({ seq: last + 1 + i, at, actor: 'agent', ...e }) + '\n').join(''))

  werk.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': {
        steps: [
          edit(`${PLAN}/spec.md`, SPEC),
          edit(`${PLAN}/spec.answers.json`, JSON.stringify([{ slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long does a token live?', body: 'A token lives one hour.' }])),
        ],
      },
      'ticket-writer': {
        steps: [
          edit(`${PLAN}/tickets/11-login.md`, ticket('login', 'auth', '1')),
          edit(`${PLAN}/tickets/12-logout.md`, ticket('logout', 'auth-session', '2')),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify([{ slug: 'split-login', title: 'Split login in two', why: 'Is login one ticket?', body: 'Login is two tickets.' }])),
        ],
      },
    },
  })
  werk.cli(['plan', 'auth'])

  // The board shows the two tickets.
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('li[data-ticket="11"]')).toContainText('login')
  await expect(page.locator('li[data-ticket="12"]')).toContainText('logout')

  // Each ghost shows its title, why and body, and the ✓ accepts it alone.
  await page.goto(`${werk.url}#auth-token-ttl`)
  await expect(page.locator('body')).toContainText('Tokens live one hour')
  await expect(page.locator('body')).toContainText('How long does a token live?')
  await expect(page.locator('body')).toContainText('A token lives one hour.')
  await page.getByRole('button', { name: 'Accept #auth-token-ttl' }).click()
  await expect(page.getByRole('button', { name: 'Accept #auth-token-ttl' })).toHaveCount(0)

  await page.goto(`${werk.url}#auth-split-login`)
  await expect(page.locator('body')).toContainText('Split login in two')
  await expect(page.locator('body')).toContainText('Is login one ticket?')
  await expect(page.locator('body')).toContainText('Login is two tickets.')
  await expect(page.getByRole('button', { name: 'Accept #auth-split-login' })).toBeVisible()
  await page.getByRole('button', { name: 'Accept #auth-split-login' }).click()
  await expect(page.getByRole('button', { name: 'Accept #auth-split-login' })).toHaveCount(0)

  const accepts = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type === 'node.accepted' && e.actor === 'you')
  expect(accepts.map((e) => e.payload.id).slice(-2)).toEqual(['auth-token-ttl', 'auth-split-login'])
})
