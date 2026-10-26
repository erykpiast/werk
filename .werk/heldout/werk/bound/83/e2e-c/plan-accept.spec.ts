/** Held-out step 82.1 in a browser: the plan's tickets on the board and its ghosts accepted with ✓. */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'

const PLAN = '.werk/plans/auth'
const SPEC = '# Spec\n\n## User Stories\n\n1. As a person, I log in.\n2. As a person, I log out.\n'
const ticket = (title: string, cites: string, stories: string, blockedBy = '') =>
  `title: ${title}\ncites: ${cites}\nblocked_by: ${blockedBy}\nstories: ${stories}\ntouches: login form\n\n` +
  `## What to build\n\nBuild ${title}.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- \`make test\`\n`
const answer = (slug: string) => ({ slug, title: `Title of ${slug}`, why: `Why ${slug}?`, body: `Body of ${slug}.` })
const edit = (path: string, content: string) => ({ edit: { path, content } })

test('82.1 a plan over a decided subtree: tier first, two tickets on the board, two ghosts accepted one at a time with ✓', async ({ page, werk }) => {
  const logFile = join(werk.dir, '.werk', 'log.jsonl')
  const lines = () => readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  let seq = lines().at(-1).seq
  const add = (type: string, payload: object) =>
    appendFileSync(logFile, JSON.stringify({ seq: ++seq, at: new Date().toISOString(), actor: 'agent', type, payload }) + '\n')
  add('node.proposed', { id: 'auth', kind: 'card', title: 'Auth', status: 'decided', who: 'you' })
  add('node.accepted', { id: 'auth' })
  add('node.proposed', { id: 'auth-login', kind: 'card', title: 'Login', status: 'decided', parent: 'auth' })
  add('node.accepted', { id: 'auth-login' })

  writeFileSync(
    join(dirname(werk.dir), 'agent-script.json'),
    JSON.stringify({
      steps: [],
      roles: {
        'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify([answer('token-ttl')]))] },
        'ticket-writer': {
          steps: [
            edit(`${PLAN}/tickets/11-login.md`, ticket('Log in with a password', 'auth, auth-login', '1')),
            edit(`${PLAN}/tickets/12-logout.md`, ticket('Log out everywhere', 'auth', '2', '11')),
            edit(`${PLAN}/tickets.answers.json`, JSON.stringify([answer('split-login')])),
          ],
        },
      },
    }),
  )
  const boardFile = join(werk.dir, '.werk', 'board.jsonl')
  const boardBefore = readFileSync(boardFile, 'utf8').trim().split('\n').length
  werk.cli(['plan', 'auth'])
  const runEvents = readFileSync(boardFile, 'utf8').trim().split('\n').slice(boardBefore).map((l) => JSON.parse(l))
  expect(runEvents[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })

  // The board shows the two tickets.
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('li[data-ticket="11"]')).toContainText('Log in with a password')
  await expect(page.locator('li[data-ticket="12"]')).toContainText('Log out everywhere')

  // The map shows each ghost under #auth, with who and its words.
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  const toMap = () => page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  for (const slug of ['token-ttl', 'split-login']) {
    await toMap()
    const id = `auth-${slug}`
    const li = page.locator(`li[data-card-id="auth"] > ul > li[data-card-id="${id}"]`)
    await expect(li).toHaveAttribute('data-proposed', 'true')
    await li.locator('> a').click()
    const card = page.getByTestId('card')
    await expect(card).toHaveAttribute('data-card-id', id)
    await expect(card).toHaveAttribute('data-proposed', 'true')
    await expect(card).toContainText(`Title of ${slug}`)
    await expect(card).toContainText(`Why ${slug}?`)
    await expect(card).toContainText(`Body of ${slug}.`)
    await expect(card).toContainText('me')
  }

  // Accept each ghost, one at a time.
  await toMap()
  await page.locator('li[data-card-id="auth-token-ttl"] > a').click()
  await page.getByRole('button', { name: 'Accept #auth-token-ttl' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await toMap()
  await expect(page.locator('li[data-card-id="auth-token-ttl"]')).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator('li[data-card-id="auth-split-login"]')).toHaveAttribute('data-proposed', 'true')
  await page.locator('li[data-card-id="auth-split-login"] > a').click()
  await page.getByRole('button', { name: 'Accept #auth-split-login' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const accepts = lines().filter((e) => e.type === 'node.accepted' && String(e.payload.id).startsWith('auth-'))
  expect(accepts.map((e) => [e.payload.id, e.actor])).toEqual([
    ['auth-login', 'agent'],
    ['auth-token-ttl', 'you'],
    ['auth-split-login', 'you'],
  ])
})
