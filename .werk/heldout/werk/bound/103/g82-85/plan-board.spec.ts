/** Held-out step 82.1, browser part: the plan's tickets on the board, and ✓ on each answer ghost one at a time. */
import { join } from 'node:path'
import { appendEvent } from '../../src/map/log.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { expect, test } from '../../e2e/harness.ts'

const PLAN = '.werk/plans/auth'
const SPEC = '# Spec: auth\n\n## Problem Statement\n\nNo login.\n\n## User Stories\n\n1. As a person, I want to log in, so that I see my map.\n2. As a person, I want to log out, so that I leave.\n'
const ticket = (title: string, cites: string, stories: string, touches: string) =>
  `title: ${title}\ncites: ${cites}\nblocked_by:\nstories: ${stories}\ntouches: ${touches}\n\n## What to build\n\nThe ${title} flow.\n\n## Acceptance criteria\n\n- The ${title} flow works.\n\n## Checks\n\n- \`make test\`\n`
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })

test('82.1 the board shows the plan tickets, and each answer ghost is accepted alone with ✓', async ({ page, werk }) => {
  const log = join(werk.dir, '.werk', 'log.jsonl')
  appendEvent(log, { type: 'node.proposed', payload: { id: 'auth', kind: 'card', title: 'Auth', status: 'decided', who: 'you' } }, 'you')
  appendEvent(log, { type: 'node.proposed', payload: { id: 'auth-session', kind: 'card', title: 'Sessions', status: 'decided', parent: 'auth' } }, 'agent')
  appendEvent(log, { type: 'node.accepted', payload: { id: 'auth-session' } }, 'you')
  const answers = {
    spec: [{ slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long does a token live?', body: 'A token expires after one hour.' }],
    tickets: [{ slug: 'split-login', title: 'Login is its own ticket', why: 'Is login split out?', body: 'Login ships alone.' }],
  }
  werk.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify(answers.spec))] },
      'ticket-writer': {
        steps: [
          edit(`${PLAN}/tickets/11-login.md`, ticket('login', 'auth', '1', 'sign in')),
          edit(`${PLAN}/tickets/12-logout.md`, ticket('logout', 'auth-session', '2', 'sign out')),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify(answers.tickets)),
        ],
      },
    },
  })
  werk.cli(['plan', 'auth'])

  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('li[data-ticket="11"]')).toContainText('login')
  await expect(page.locator('li[data-ticket="12"]')).toContainText('logout')

  await page.goto(werk.url)
  for (const id of ['auth-token-ttl', 'auth-split-login']) {
    await expect(page.locator(`${'li[data-card-id="auth"]'} > ul > li[data-card-id="${id}"]`)).toHaveAttribute('data-proposed', 'true')
  }
  await page.goto(`${werk.url}#auth-token-ttl`)
  const detail = page.getByTestId('card')
  await expect(detail).toContainText('Tokens live one hour')
  await expect(detail).toContainText('How long does a token live?')
  await expect(detail).toContainText('A token expires after one hour.')
  await page.getByRole('button', { name: 'Accept #auth-token-ttl' }).click()
  await expect(detail).toHaveAttribute('data-proposed', 'false')

  await page.goto(`${werk.url}#auth-split-login`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'true')
  await expect(page.getByTestId('card')).toContainText('Login is its own ticket')
  await page.getByRole('button', { name: 'Accept #auth-split-login' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
})
