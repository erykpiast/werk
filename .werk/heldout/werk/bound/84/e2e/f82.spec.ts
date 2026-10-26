/** Feature 82, step 1: a plan, then the person accepts each proposed answer with the ✓ button. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { accepted, proposed } from '../../src/test/map-events.ts'
import { expect, open, test } from './harness.ts'

const PLAN = '.werk/plans/auth'
const SPEC = ['# Spec: auth', '', '## User Stories', '', '1. As a person, I want to log in.', '2. As a person, I want my session to last.', ''].join('\n')
const ticket = (title: string, cites: string, stories: string, touches: string) =>
  [
    `title: ${title}`,
    `cites: ${cites}`,
    'blocked_by:',
    `stories: ${stories}`,
    `touches: ${touches}`,
    '',
    '## What to build',
    '',
    `Build ${title.toLowerCase()} for the person.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] It works for the person.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
const edit = (path: string, content: string) => ({ edit: { path, content } })
const answer = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Which ${slug} applies?`, body: `The body of ${slug}.` })

test('82.1 a plan over a decided subtree records a feature run, writes a spec and tickets, and puts the answers on the map as proposals', async ({ page, proj }) => {
  proj.seed(
    proposed('auth', { title: 'Auth', status: 'decided' }),
    accepted('auth'),
    proposed('auth-session', { title: 'Sessions', status: 'decided', parent: 'auth' }),
    accepted('auth-session'),
  )
  proj.script({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify([answer('token-ttl')]))] },
      'ticket-writer': {
        steps: [
          edit(`${PLAN}/tickets/01-login.md`, ticket('Log in with a link', 'auth', '1', 'login flow')),
          edit(`${PLAN}/tickets/02-session.md`, ticket('Keep the session', 'auth-session', '2', 'session store')),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify([answer('split-login')])),
        ],
      },
    },
  })
  const out = proj.run(['plan', 'auth'])
  console.log('82.1 plan:', out.code, out.stdout, out.stderr)
  expect(out.code).toBe(0)
  const board = readFileSync(join(proj.dir, '.werk', 'board.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  expect(board[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  for (const id of ['auth-token-ttl', 'auth-split-login']) expect(proj.cli(['show', id])).toContain('who: me')

  await open(page, proj)
  for (const slug of ['token-ttl', 'split-login']) {
    const li = page.locator(`li[data-card-id="auth"] > ul > li[data-card-id="auth-${slug}"]`)
    await expect(li).toHaveAttribute('data-proposed', 'true')
  }
  for (const slug of ['token-ttl', 'split-login']) {
    await page.goto(page.url().replace(/#.*$/, '') + `#auth-${slug}`)
    const card = page.getByTestId('card')
    await expect(card.getByRole('heading', { level: 1 })).toHaveText(`Answer ${slug}`)
    await expect(card.locator('.why')).toContainText(`Which ${slug} applies?`)
    await expect(card.locator('.body')).toContainText(`The body of ${slug}.`)
    await expect(card.locator('dl')).toContainText('who')
  }
  await page.goto(page.url().replace(/#.*$/, '') + '#auth-token-ttl')
  await page.getByRole('button', { name: /Accept #auth-token-ttl/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  expect(proj.cli(['show', 'auth-split-login'])).toContain('state: ghost')
  await page.goto(page.url().replace(/#.*$/, '') + '#auth-split-login')
  await page.getByRole('button', { name: /Accept #auth-split-login/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')

  await page.goto(page.url().replace(/#.*$/, '') + '#/board')
  await expect(page.locator('li[data-ticket="1"]')).toContainText('Log in with a link')
  await expect(page.locator('li[data-ticket="2"]')).toContainText('Keep the session')
})
