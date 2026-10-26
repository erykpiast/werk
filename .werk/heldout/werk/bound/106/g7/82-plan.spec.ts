/** Held-out steps 82.1 to 82.5: the plan verb over a decided subtree. */
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import { join } from 'node:path'
import { appendMap, column, decidedCard, openBoard, readJsonl, werkRun } from './helpers.ts'

const PLAN = '.werk/plans/auth'
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })

const spec = (stories: number[]) =>
  ['# Spec: auth', '', '## User Stories', '', ...stories.map((n) => `${n}. As a person, I want auth part ${n}, so that I sign in.`), ''].join('\n')

type T = { title: string; cites: string; blockedBy?: string; stories?: string | null; touches: string; noAcceptance?: boolean }
const ticketText = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blockedBy ?? ''}`,
    ...(t.stories === null ? [] : [`stories: ${t.stories ?? '1'}`]),
    `touches: ${t.touches}`,
    '',
    '## What to build',
    '',
    `The person can do ${t.title}.`,
    '',
    ...(t.noAcceptance ? [] : ['## Acceptance criteria', '', `- [ ] ${t.title} works.`, '']),
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

type Answer = { slug: string; title: string; why: string; body: string }
function writers(werk: Werk, stories: number[], tickets: Record<string, T>, answers: { spec?: Answer[]; tickets?: Answer[] } = {}) {
  werk.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, spec(stories)), edit(`${PLAN}/spec.answers.json`, JSON.stringify(answers.spec ?? []))] },
      'ticket-writer': {
        steps: [
          ...Object.entries(tickets).map(([name, t]) => edit(`${PLAN}/tickets/${name}`, ticketText(t))),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify(answers.tickets ?? [])),
        ],
      },
    },
  })
}

/** The decided subtree under #auth: #auth-session and #auth-login. */
const authSubtree = (werk: Werk) => appendMap(werk.dir, [...decidedCard('auth'), ...decidedCard('auth-session', 'auth'), ...decidedCard('auth-login', 'auth')])



test('82.1 a plan records a feature run, puts tickets on the board, and proposes the answers as ghosts', async ({ page, werk }) => {
  authSubtree(werk)
  const boardBefore = readJsonl(join(werk.dir, '.werk', 'board.jsonl')).length
  const tokenTtl = { slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long does a token live?', body: 'A token expires after one hour.' }
  const splitLogin = { slug: 'split-login', title: 'Login splits in two steps', why: 'Is login one step?', body: 'Login asks the email first, then the code.' }
  writers(
    werk,
    [1, 2],
    {
      '11-login.md': { title: 'login', cites: 'auth, auth-login', stories: '1', touches: 'login form' },
      '12-logout.md': { title: 'logout', cites: 'auth-session', stories: '2', touches: 'session store' },
    },
    { spec: [tokenTtl], tickets: [splitLogin] },
  )
  const r = werkRun(werk.dir, ['plan', 'auth'])
  expect(r.code, r.stdout + r.stderr).toBe(0)

  const runEvents = readJsonl<{ type: string; payload: { tier?: string } }>(join(werk.dir, '.werk', 'board.jsonl')).slice(boardBefore)
  expect(runEvents[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })

  await openBoard(page)
  const all = page.locator('li[data-ticket]')
  await expect(all.filter({ hasText: /^login/ })).toHaveCount(1)
  await expect(all.filter({ hasText: /^logout/ })).toHaveCount(1)

  for (const a of [tokenTtl, splitLogin]) {
    await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
    const id = `auth-${a.slug}`
    const li = page.locator(`li[data-card-id="auth"] li[data-card-id="${id}"]`)
    await expect(li).toHaveAttribute('data-proposed', 'true')
    await li.locator(`a[href="#${id}"]`).first().click()
    const card = page.getByTestId('card')
    await expect(card).toHaveAttribute('data-card-id', id)
    await expect(card).toHaveAttribute('data-proposed', 'true')
    await expect(card.getByRole('heading', { level: 1 })).toHaveText(a.title)
    await expect(card.locator('.why')).toContainText(a.why)
    await expect(card.locator('.body')).toContainText(a.body)
    await expect(card.locator('dl')).toContainText('whome')
  }

  // Accept one ghost: only it becomes real.
  const mapLink = page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' })
  await mapLink.click()
  await page.locator('li[data-card-id="auth-token-ttl"] a[href="#auth-token-ttl"]').first().click()
  await page.getByRole('button', { name: 'Accept #auth-token-ttl' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await mapLink.click()
  await expect(page.locator('li[data-card-id="auth-token-ttl"]')).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator('li[data-card-id="auth-split-login"]')).toHaveAttribute('data-proposed', 'true')
  await page.locator('li[data-card-id="auth-split-login"] a[href="#auth-split-login"]').first().click()
  await page.getByRole('button', { name: 'Accept #auth-split-login' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await mapLink.click()
  await expect(page.locator('li[data-card-id="auth-split-login"]')).toHaveAttribute('data-proposed', 'false')
})

test('82.2 an answer whose id is already in the map stops the plan with an error', async ({ page, werk }) => {
  authSubtree(werk)
  appendMap(werk.dir, decidedCard('auth-token-ttl', 'auth'))
  writers(
    werk,
    [1, 2],
    {
      '11-login.md': { title: 'login', cites: 'auth, auth-login', stories: '1', touches: 'login form' },
      '12-logout.md': { title: 'logout', cites: 'auth-session', stories: '2', touches: 'session store' },
    },
    { spec: [{ slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long?', body: 'One hour.' }] },
  )
  const r = werkRun(werk.dir, ['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const proposals = readJsonl<{ type: string; payload: { id?: string } }>(join(werk.dir, '.werk', 'log.jsonl')).filter(
    (e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl',
  )
  expect(proposals).toHaveLength(1)
  await expect(page.locator('li[data-card-id="auth-token-ttl"]')).toHaveCount(1)
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', async ({ page, werk }) => {
  authSubtree(werk)
  writers(werk, [1], {
    '11-login.md': { title: 'login', cites: 'auth-session', stories: null, touches: 'login form' },
    '12-logout.md': { title: 'logout', cites: 'auth, auth-login', stories: '1', touches: 'session store' },
  })
  const r = werkRun(werk.dir, ['plan', 'auth'])
  const out = r.stdout + r.stderr
  await openBoard(page)
  const all = page.locator('li[data-ticket]')
  await expect(all.filter({ hasText: /^logout/ })).toHaveCount(1)
  await expect(all.filter({ hasText: /^login/ })).toHaveCount(0)
  expect(out).toMatch(/11-login\.md: shape: stories: .*stories/)
  expect(out).toMatch(/cards-cited.*#auth-session/)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its correct blocker goes to ready', async ({ page, werk }) => {
  authSubtree(werk)
  writers(werk, [1], {
    '21-a.md': { title: 'a', cites: 'auth-session', stories: '1', touches: 'login form', noAcceptance: true },
    '22-b.md': { title: 'b', cites: 'auth, auth-login, auth-session', stories: '1', touches: 'session store' },
    '23-c.md': { title: 'c', cites: 'auth, auth-login', blockedBy: '21, 22', stories: '1', touches: 'audit trail' },
  })
  werkRun(werk.dir, ['plan', 'auth'])
  await openBoard(page)
  await expect(page.locator('li[data-ticket]').filter({ hasText: /^a(?![a-z])/ })).toHaveCount(0)
  await expect(column(page, 'blocked').locator('li[data-ticket="23"]')).toHaveCount(1)
  await expect(column(page, 'ready').locator('li[data-ticket="22"]')).toHaveCount(1)
})

test('82.5 a second plan archives a dropped open ticket, and a restore puts it back', async ({ page, werk }) => {
  authSubtree(werk)
  writers(werk, [1, 2], {
    '11-login.md': { title: 'login', cites: 'auth, auth-login', stories: '1', touches: 'login form' },
    '12-logout.md': { title: 'logout', cites: 'auth-session', stories: '2', touches: 'session store' },
  })
  expect(werkRun(werk.dir, ['plan', 'auth']).code).toBe(0)
  await openBoard(page)
  await expect(column(page, 'ready').locator('li[data-ticket="11"]')).toBeVisible()
  await expect(column(page, 'ready').locator('li[data-ticket="12"]')).toBeVisible()

  writers(werk, [1], { '11-login.md': { title: 'login', cites: 'auth, auth-login, auth-session', stories: '1', touches: 'login form' } })
  werkRun(werk.dir, ['plan', 'auth'])
  const archived = readJsonl<{ type: string; payload: { number: number; reason?: string } }>(join(werk.dir, '.werk', 'board.jsonl')).filter(
    (e) => e.type === 'ticket.archived' && e.payload.number === 12,
  )
  expect(archived).toHaveLength(1)
  expect(archived[0]!.payload.reason).toMatch(/current spec .* no longer needs it/)
  await expect(page.locator('li[data-ticket="12"]')).toHaveCount(0)
  await expect(column(page, 'ready').locator('li[data-ticket="11"]')).toBeVisible()

  const r = werkRun(werk.dir, ['ticket', 'restore', '12'])
  expect(r.code, r.stderr).toBe(0)
  await expect(column(page, 'ready').locator('li[data-ticket="12"]')).toBeVisible()
})
