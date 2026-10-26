/** Held-out step 82.1: a plan over "#auth", seen on the board and the map. */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'

const SPEC = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'test', 'fixtures', 'tickets', 'spec.md'), 'utf8')
const PLAN = '.werk/plans/auth'
const lines = (path: string) =>
  readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { seq: number; type: string; actor: string; payload: Record<string, unknown> })

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
    `${title}.`,
    '',
    '## Acceptance criteria',
    '',
    `- [ ] ${title} works.`,
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

const records = {
  'token-ttl': { slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long does a token live?', body: 'A token expires after one hour.' },
  'split-login': { slug: 'split-login', title: 'Login splits in two tickets', why: 'Is login one ticket?', body: 'The form and the session are two tickets.' },
}

test('82.1 A plan over a decided subtree records a feature run, writes a spec and tickets, and puts the answers on the map as proposals', async ({ page, werk }) => {
  const log = join(werk.dir, '.werk', 'log.jsonl')
  const boardLog = join(werk.dir, '.werk', 'board.jsonl')
  let seq = lines(log).at(-1)!.seq
  const at = '2026-10-21T03:00:00.000Z'
  const ev = (actor: string, type: string, payload: object) => JSON.stringify({ seq: ++seq, at, actor, type, payload }) + '\n'
  appendFileSync(
    log,
    ev('agent', 'node.proposed', { id: 'auth', kind: 'card', title: 'Auth', why: 'People sign in.', status: 'decided', who: 'you' }) +
      ev('agent', 'node.proposed', { id: 'auth-session', kind: 'card', title: 'Sessions', status: 'decided', parent: 'auth' }) +
      ev('agent', 'node.proposed', { id: 'auth-login', kind: 'card', title: 'Login form', status: 'decided', parent: 'auth' }) +
      ev('you', 'node.accepted', { id: 'auth-session' }) +
      ev('you', 'node.accepted', { id: 'auth-login' }),
  )
  const edit = (path: string, content: string) => ({ edit: { path, content } })
  werk.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify([records['token-ttl']]))] },
      'ticket-writer': {
        steps: [
          edit(`${PLAN}/tickets/07-login.md`, ticket('Sign in with a password', 'auth, auth-login', '1, 2', 'login form')),
          edit(`${PLAN}/tickets/08-session.md`, ticket('Keep the session alive', 'auth-session', '3', 'session store')),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify([records['split-login']])),
        ],
      },
    },
  })
  const boardBefore = lines(boardLog).length

  // When the person runs the plan over "#auth"
  werk.cli(['plan', 'auth'])

  // Then the first event of the run in the log is a tier event with the tier "feature"
  const runEvents = lines(boardLog).slice(boardBefore)
  expect(runEvents[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })

  // And the board shows the two tickets
  await page.goto(`${werk.url}#/board`)
  await expect(page.locator('li[data-ticket="7"]')).toContainText('Sign in with a password')
  await expect(page.locator('li[data-ticket="8"]')).toContainText('Keep the session alive')

  // And the map shows ghost cards that refine "#auth"
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  for (const id of ['auth-token-ttl', 'auth-split-login']) {
    await expect(map.locator(`li[data-card-id="auth"] > ul > li[data-card-id="${id}"]`)).toHaveAttribute('data-proposed', 'true')
  }

  // Each ghost shows the title, the why and the body from its record, with the agent as the one who decides.
  // The person accepts each ghost one at a time with the ✓ button.
  for (const [id, r] of [
    ['auth-token-ttl', records['token-ttl']],
    ['auth-split-login', records['split-login']],
  ] as const) {
    await page.goto(`${werk.url}#${id}`)
    const card = page.getByTestId('card')
    await expect(card).toHaveAttribute('data-proposed', 'true')
    await expect(card.getByRole('heading', { level: 1 })).toHaveText(r.title)
    await expect(card.locator('.why')).toContainText(r.why)
    await expect(card.locator('.body')).toContainText(r.body)
    await expect(card.locator('dl')).toContainText('whome')
    const acceptsBefore = lines(log).filter((l) => l.type === 'node.accepted').length
    await page.getByRole('button', { name: `Accept #${id}` }).click()
    await expect(card).toHaveAttribute('data-proposed', 'false')
    const accepts = lines(log).filter((l) => l.type === 'node.accepted')
    expect(accepts.length).toBe(acceptsBefore + 1)
    expect(accepts.at(-1)).toMatchObject({ actor: 'you', payload: { id } })
  }
})
