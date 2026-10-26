import { card, expect, real, test } from './harness.ts'

const PLAN = '.werk/plans/auth'
const SPEC = ['# Spec', '', '## User Stories', '', '1. As a person, I want to log in.', '2. As a person, I want to log out.', ''].join('\n')
const ticket = (title: string, cites: string, stories: string) =>
  [`title: ${title}`, `cites: auth, ${cites}`, 'blocked_by:', `stories: ${stories}`, 'touches: auth flow', '', '## What to build', '', `A person can ${title}.`, '', '## Acceptance criteria', '', '- [ ] It works.', '', '## Checks', '', '- `make test`', ''].join('\n')
const edit = (path: string, content: string) => ({ edit: { path, content } })

test('82.1 a plan over a decided subtree records a feature run, writes a spec and tickets, and puts the answers on the map as proposals', async ({ page, boot }) => {
  const werk = await boot({
    log: [
      ...real('auth', 'Auth', { status: 'decided', who: 'you' }),
      ...real('auth-login', 'Login', { status: 'decided', parent: 'auth' }),
      ...real('auth-logout', 'Logout', { status: 'decided', parent: 'auth' }),
    ],
  })
  const ttl = { slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long does a token live?', body: 'One hour, then a refresh.' }
  const split = { slug: 'split-login', title: 'Split login in two', why: 'How many tickets for login?', body: 'Two tickets.' }
  werk.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify([ttl]))] },
      'ticket-writer': {
        steps: [
          edit(`${PLAN}/tickets/01-login.md`, ticket('log in', 'auth-login', '1')),
          edit(`${PLAN}/tickets/02-logout.md`, ticket('log out', 'auth-logout', '2')),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify([split])),
        ],
      },
    },
  })
  const r = werk.run(['plan', 'auth'])
  expect(r.status, r.stdout + r.stderr).toBe(0)

  const run = werk.boardLines()
  expect(run[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })

  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('li.ticket', { hasText: 'log in' })).toHaveCount(1)
  await expect(page.locator('li.ticket', { hasText: 'log out' })).toHaveCount(1)

  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  for (const [id, a] of [
    ['auth-token-ttl', ttl],
    ['auth-split-login', split],
  ] as const) {
    const li = page.locator(`${card('auth')} > ul > ${card(id)}`)
    await expect(li).toHaveAttribute('data-proposed', 'true')
    await page.goto(`${werk.url}#${id}`)
    const detail = page.getByTestId('card')
    await expect(detail).toHaveAttribute('data-proposed', 'true')
    await expect(detail).toContainText(a.title)
    await expect(detail).toContainText(a.why)
    await expect(detail).toContainText(a.body)
    await expect(detail.locator('dt', { hasText: 'who' }).locator('xpath=following-sibling::dd')).toHaveText(/agent|me/)
    await page.goto(werk.url)
  }

  for (const id of ['auth-token-ttl', 'auth-split-login']) {
    await page.goto(`${werk.url}#${id}`)
    await page.getByRole('button', { name: /✓|accept/i }).click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  }
  const accepts = werk.logLines().filter((l) => l.type === 'node.accepted' && l.actor === 'you').map((l) => (l.payload as { id: string }).id)
  expect(accepts.slice(-2)).toEqual(['auth-token-ttl', 'auth-split-login'])
})
