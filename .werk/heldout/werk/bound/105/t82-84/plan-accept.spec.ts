/** Held-out step 82.1: a plan over "#auth" records a feature run, writes a spec and tickets, and puts the answers on the map as ghosts. */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'

const PLAN = '.werk/plans/auth'
const SPEC = '# Spec: auth\n\n## User Stories\n\n1. As a person, I want to log in, so that I see my map.\n2. As a person, I want to log out, so that I end my session.\n'

const ticketText = (title: string, cites: string, stories: string) =>
  [
    `title: ${title}`,
    `cites: ${cites}`,
    'blocked_by:',
    `stories: ${stories}`,
    'touches: session store',
    '',
    '## What to build',
    '',
    `A person can ${title.toLowerCase()}.`,
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

const record = (slug: string) => ({ slug, title: `Title of ${slug}`, why: `Which ${slug} do we pick?`, body: `The body of ${slug}.` })

test('82.1 a plan over a decided subtree records a feature run, writes a spec and tickets, and puts the answers on the map as proposals', async ({ page, werk }) => {
  // Given a map with a decided subtree under the root card "#auth"
  const logFile = join(werk.dir, '.werk', 'log.jsonl')
  const lines = readFileSync(logFile, 'utf8').trim().split('\n')
  let seq = (JSON.parse(lines.at(-1)!) as { seq: number }).seq
  const ev = (type: string, payload: unknown, actor = 'agent') =>
    JSON.stringify({ seq: ++seq, at: new Date().toISOString(), actor, type, payload })
  appendFileSync(
    logFile,
    [
      ev('node.proposed', { id: 'auth', kind: 'card', title: 'Auth', status: 'decided', who: 'you' }),
      ev('node.accepted', { id: 'auth' }, 'you'),
      ev('node.proposed', { id: 'auth-login', kind: 'card', title: 'Login by mail', status: 'decided', parent: 'auth' }),
      ev('node.accepted', { id: 'auth-login' }, 'you'),
    ].join('\n') + '\n',
  )
  const boardBefore = readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8').trim().split('\n').length

  // And the spec writer returns one spec and one answer record "token-ttl"; the ticket writer two tickets and "split-login"
  werk.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': {
        steps: [
          { edit: { path: `${PLAN}/spec.md`, content: SPEC } },
          { edit: { path: `${PLAN}/spec.answers.json`, content: JSON.stringify([record('token-ttl')]) } },
        ],
      },
      'ticket-writer': {
        steps: [
          { edit: { path: `${PLAN}/tickets/21-login.md`, content: ticketText('Log in', 'auth, auth-login', '1') } },
          { edit: { path: `${PLAN}/tickets/22-logout.md`, content: ticketText('Log out', 'auth-login', '2') } },
          { edit: { path: `${PLAN}/tickets.answers.json`, content: JSON.stringify([record('split-login')]) } },
        ],
      },
    },
  })

  // When the person runs the plan over "#auth"
  werk.cli(['plan', 'auth'])

  // Then the first event of the run in the log is a tier event with the tier "feature"
  const board = readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  expect(board[boardBefore]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })

  // And the board shows the two tickets
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('li[data-ticket="21"]')).toContainText('Log in')
  await expect(page.locator('li[data-ticket="22"]')).toContainText('Log out')

  // And the map shows each ghost under "#auth", with the agent as the one who decides, and its title, why and body
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  for (const slug of ['token-ttl', 'split-login']) {
    await expect(page.locator(`li[data-card-id="auth"] > ul > li[data-card-id="auth-${slug}"]`)).toHaveAttribute('data-proposed', 'true')
  }
  for (const slug of ['token-ttl', 'split-login']) {
    const id = `auth-${slug}`
    await page.goto(`${werk.url}#${id}`)
    const card = page.getByTestId('card')
    await expect(card).toHaveAttribute('data-proposed', 'true')
    await expect(card.locator('h1')).toHaveText(`Title of ${slug}`)
    await expect(card.locator('.why')).toContainText(`Which ${slug} do we pick?`)
    await expect(card.locator('.body')).toContainText(`The body of ${slug}.`)
    await expect(card.locator('dl')).toContainText(/who\s*me/)
  }

  // And the person can accept each ghost one at a time with the ✓ button
  for (const id of ['auth-token-ttl', 'auth-split-login']) {
    await page.goto(`${werk.url}#${id}`)
    await page.getByRole('button', { name: `Accept #${id}` }).click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
    if (id === 'auth-token-ttl') {
      await page.goto(`${werk.url}#auth-split-login`)
      await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'true')
    }
  }
})
