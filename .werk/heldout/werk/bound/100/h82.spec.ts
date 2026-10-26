/** Held-out step 82.1: a plan over a decided subtree, seen on the board and the map. */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../e2e/harness.ts'

const lines = (path: string) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { seq: number; type: string; payload: Record<string, unknown> })

const PLAN = '.werk/plans/auth'
const edit = (path: string, content: string) => ({ edit: { path, content } })
const ticket = (title: string, cites: string, touches: string) =>
  `title: ${title}\ncites: ${cites}\nblocked_by:\nstories: 1\ntouches: ${touches}\n\n## What to build\n\nA person can ${title}.\n\n## Acceptance criteria\n\n- [ ] A person can ${title}.\n\n## Checks\n\n- \`make test\`\n`

test('82.1 A plan over a decided subtree records a feature run, writes a spec and tickets, and puts the writers answers on the map as proposals', async ({ page, werk }) => {
  // Given a map with a decided subtree under the root card "#auth"
  const log = join(werk.dir, '.werk', 'log.jsonl')
  const seq = lines(log).at(-1)!.seq
  const at = new Date().toISOString()
  const ev = (n: number, actor: string, type: string, payload: unknown) => JSON.stringify({ seq: seq + n, at, actor, type, payload })
  appendFileSync(
    log,
    [
      ev(1, 'agent', 'node.proposed', { id: 'auth', kind: 'card', title: 'Authentication', status: 'decided', who: 'you' }),
      ev(2, 'agent', 'node.proposed', { id: 'auth-session', kind: 'card', title: 'Sessions', status: 'decided', parent: 'auth' }),
      ev(3, 'you', 'node.accepted', { id: 'auth' }),
      ev(4, 'you', 'node.accepted', { id: 'auth-session' }),
    ].join('\n') + '\n',
  )
  // And the spec writer returns one spec and one answer record with the slug "token-ttl", a title, a why and a body
  // And the ticket writer returns two tickets that pass all checks and one answer record with the slug "split-login"
  const tokenTtl = { slug: 'token-ttl', title: 'A token lives one hour', why: 'How long does a token live?', body: 'One hour, then a refresh.' }
  const splitLogin = { slug: 'split-login', title: 'Login splits in two tickets', why: 'How many tickets does login need?', body: 'Two: login and logout.' }
  werk.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': {
        steps: [
          edit(`${PLAN}/spec.md`, '# Spec\n\n## User Stories\n\n1. As a person, I want to log in, so that I can work.\n'),
          edit(`${PLAN}/spec.answers.json`, JSON.stringify([tokenTtl])),
        ],
      },
      'ticket-writer': {
        steps: [
          edit(`${PLAN}/tickets/21-login.md`, ticket('log in', 'auth, auth-session', 'login form')),
          edit(`${PLAN}/tickets/22-logout.md`, ticket('log out', 'auth', 'session store')),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify([splitLogin])),
        ],
      },
    },
  })
  const board = join(werk.dir, '.werk', 'board.jsonl')
  const boardBefore = lines(board).length
  // When the person runs the plan over "#auth"
  werk.cli(['plan', 'auth'])
  // Then the first event of the run in the log is a tier event with the tier "feature"
  const runEvents = lines(board).slice(boardBefore)
  expect(runEvents[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })

  // And the board shows the two tickets
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('li[data-ticket="21"]')).toContainText('log in')
  await expect(page.locator('li[data-ticket="22"]')).toContainText('log out')

  // And the map shows each ghost card that refines "#auth", with the agent as the one who decides
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  for (const [id, a] of [
    ['auth-token-ttl', tokenTtl],
    ['auth-split-login', splitLogin],
  ] as const) {
    await page.goto(werk.url)
    const tile = page.locator(`li[data-card-id="auth"] > ul > li[data-card-id="${id}"] > a`)
    await expect(tile).toHaveClass(/ghost/)
    await tile.click()
    const detail = page.getByTestId('card')
    await expect(detail).toHaveAttribute('data-card-id', id)
    await expect(detail).toHaveAttribute('data-proposed', 'true')
    await expect(detail.locator('dt', { hasText: 'who' }).locator('xpath=following-sibling::dd')).toHaveText('me')
    // And each ghost shows the title, the why and the body from its record
    await expect(detail.getByRole('heading', { level: 1 })).toHaveText(a.title)
    await expect(detail.locator('.why')).toContainText(a.why)
    await expect(detail.locator('.body')).toContainText(a.body)
  }

  // And the person can accept each ghost one at a time with the ✓ button
  await page.goto(`${werk.url}#auth-token-ttl`)
  await page.getByRole('button', { name: 'Accept #auth-token-ttl' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  await expect(page.locator('li[data-card-id="auth-split-login"] > a')).toHaveClass(/ghost/)
  await page.goto(`${werk.url}#auth-split-login`)
  await page.getByRole('button', { name: 'Accept #auth-split-login' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
})
