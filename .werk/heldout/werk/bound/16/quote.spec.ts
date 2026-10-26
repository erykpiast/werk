// Held-out steps 06.1 .. 06.5: quoting a transcript into a ghost excerpt.
import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, events, project, serve, writeCards, type Server } from './helpers.ts'

let server: Server | null = null

test.beforeEach(async ({ page }) => {
  await page.route('**/api/chat', (route) => route.abort())
  await page.route('https://esm.sh/**', (route) => route.abort())
  await page.addInitScript(() => localStorage.clear())
})

test.afterEach(async () => {
  await server?.stop()
  server = null
})

type Msg = { from: 'you' | 'agent' | 'tool' | 'result'; text: string }

/** A map with one card, and a conversation session whose transcript is `chat`. */
function setup(session: string, chat: Msg[]) {
  const p = project()
  writeCards(p.log, [
    { id: 'root', title: 'Root', status: 'open' },
    { id: 'logcard', title: 'The log is the source of truth', status: 'open', parent: 'root', body: 'Every view derives from the log.' },
  ])
  writeFileSync(join(p.dir, '.werk', 'session'), `${session}\n`)
  const lines = chat.map((m, i) => JSON.stringify({ at: `2026-10-01T09:0${i}:00.000Z`, ...m }))
  writeFileSync(join(p.dir, '.werk', 'chat.jsonl'), lines.join('\n') + '\n')
  return p
}

const excerptsOf = (log: string) => {
  const proposed = events(log).filter((e) => (e.type === 'node.proposed' || e.type === 'node.added') && e.payload.kind === 'excerpt')
  return proposed.map((e) => e.payload)
}

test('06.1 an exact quote becomes a ghost excerpt that cites its source', async ({ page }) => {
  const p = setup('sess-0601', [
    { from: 'you', text: 'Let us start from the data model.' },
    { from: 'agent', text: 'Fine. What should the map be?' },
    { from: 'you', text: 'I want one rule: the map is a view of the log, nothing more.' },
  ])
  server = await serve(p, 5111)
  await page.goto(`${server.url}/map/logcard`)
  await expect(page.locator('.hero h1')).toHaveText('The log is the source of truth')
  const heroBefore = await page.locator('.hero').getAttribute('class')
  const bodyBefore = await page.locator('.hero .body').innerText()
  await expect(page.locator('#sections section').filter({ hasText: 'Evidence' })).toHaveCount(0)

  const r = cli(p, ['quote', 'logcard', 'sess-0601', '--text', 'the map is a view of the log'])
  console.log('06.1 quote:', r.code, r.out)
  expect(r.code, r.out).toBe(0)
  const [ex] = excerptsOf(p.log)
  expect(ex, 'an excerpt event').toBeTruthy()
  console.log('06.1 show excerpt:\n' + cli(p, ['show', ex.id]).out)

  // The map shows a new excerpt as a ghost, waiting for the ✓.
  await page.goto(`${server.url}/map/logcard`)
  const evidence = page.locator('#sections section').filter({ has: page.getByRole('heading', { name: 'Evidence' }) })
  await expect.soft(evidence.locator(`[data-go="${ex.id}"]`), 'excerpt listed under the card').toBeVisible()
  await page.goto(`${server.url}/map/${ex.id}`)
  await expect.soft(page.locator('.hero'), 'excerpt drawn as a ghost').toHaveClass(/is-ghost/)
  await expect.soft(page.locator('.hero [data-accept-change]'), 'waiting for the ✓').toBeVisible()

  // Speaker = the user, the session named, message index recorded.
  expect.soft(ex.speaker, 'speaker is the user').toBe('you')
  expect.soft(ex.session, 'names the session').toBe('sess-0601')
  expect.soft(ex.msgIndex, 'message index of the sentence').toBe(2)
  const show = cli(p, ['show', ex.id]).out
  expect.soft(show, 'excerpt shows speaker and session').toMatch(/you · session sess-0601 · msg 2/)

  // supported_by link from the card to the excerpt.
  expect.soft(events(p.log).some((e) => e.type === 'edge.added' && e.payload.from === 'logcard' && e.payload.to === ex.id && e.payload.type === 'supported_by')).toBe(true)
  expect.soft(cli(p, ['show', 'logcard']).out).toMatch(new RegExp(`-> supported_by\\s+${ex.id.replace(/[:]/g, '\\:')}`))

  // The card itself does not change until the ✓.
  await page.goto(`${server.url}/map/logcard`)
  await expect.soft(page.locator('.hero h1')).toHaveText('The log is the source of truth')
  expect.soft(await page.locator('.hero').getAttribute('class'), 'card class unchanged').toBe(heroBefore)
  expect.soft(await page.locator('.hero .body').innerText(), 'card body unchanged').toBe(bodyBefore)
  await expect.soft(page.locator('.hero .tag.pending'), 'no pending change on the card').toHaveCount(0)
})

test('06.2 the excerpt span selects the quoted text exactly', async () => {
  const sentence = 'Every change is a new event in the log.'
  const p = setup('sess-0602', [
    { from: 'you', text: 'How do edits work?' },
    { from: 'agent', text: `Nothing is overwritten. ${sentence} The map is folded from those events on every read.` },
  ])
  const r = cli(p, ['quote', 'logcard', 'sess-0602', '--text', sentence])
  console.log('06.2 quote:', r.code, r.out)
  expect(r.code, r.out).toBe(0)
  const [ex] = excerptsOf(p.log)
  // The person opens the transcript at the recorded message and span.
  const transcript = readFileSync(join(p.dir, '.werk', 'chat.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const msg = transcript[ex.msgIndex]
  const selected = msg.text.slice(ex.span[0], ex.span[1])
  console.log('06.2 excerpt:', JSON.stringify({ msgIndex: ex.msgIndex, span: ex.span, speaker: ex.speaker, selected }))
  expect.soft(selected).toBe(sentence)
  expect.soft(ex.speaker, 'speaker is the assistant').toBe('agent')
})

test('06.3 a quote with one changed character fails and writes nothing', async ({ page }) => {
  const p = setup('sess-0603', [
    { from: 'you', text: 'No view edits a drawn card in place.' },
    { from: 'agent', text: 'Understood.' },
  ])
  const before = events(p.log).length
  const r = cli(p, ['quote', 'logcard', 'sess-0603', '--text', 'No view edits a drawn card in places.'])
  console.log('06.3 quote:', r.code, r.out)
  expect.soft(r.code, 'quote fails').not.toBe(0)
  expect.soft(r.out, 'message says no exact match').toMatch(/no exact match|does not appear verbatim/i)
  expect.soft(events(p.log).length, 'no new event').toBe(before)
  server = await serve(p, 5113)
  await page.goto(`${server.url}/map/logcard`)
  await expect(page.locator('.hero h1')).toHaveText('The log is the source of truth')
  await expect.soft(page.getByRole('heading', { name: 'Evidence' }), 'no excerpt or supported_by on the card').toHaveCount(0)
})

test('06.4 a quote that occurs in two messages fails and names the ambiguity', async ({ page }) => {
  const p = setup('sess-0604', [
    { from: 'you', text: 'One principle: the tool never guesses what I meant.' },
    { from: 'agent', text: 'Agreed, and when the input is unclear the tool never guesses; it asks.' },
  ])
  const before = events(p.log).length
  const r = cli(p, ['quote', 'logcard', 'sess-0604', '--text', 'the tool never guesses'])
  console.log('06.4 quote:', r.code, r.out)
  expect.soft(r.code, 'quote fails').not.toBe(0)
  expect.soft(r.out, 'message says more than one message').toMatch(/more than one message|appears in 2 messages/i)
  expect.soft(events(p.log).length, 'no new event').toBe(before)
  server = await serve(p, 5114)
  await page.goto(`${server.url}/map/logcard`)
  await expect(page.locator('.hero h1')).toHaveText('The log is the source of truth')
  await expect.soft(page.getByRole('heading', { name: 'Evidence' }), 'no excerpt on the card').toHaveCount(0)
})

test('06.5 an accepted excerpt shows in the card view with speaker and session', async ({ page }) => {
  const sentence = 'the map is a view of the log'
  const p = setup('sess-0605', [
    { from: 'agent', text: 'What is the core rule?' },
    { from: 'you', text: `The core rule: ${sentence}.` },
  ])
  const r = cli(p, ['quote', 'logcard', 'sess-0605', '--text', sentence])
  expect(r.code, r.out).toBe(0)
  const [ex] = excerptsOf(p.log)
  server = await serve(p, 5115)
  await page.goto(`${server.url}/map/${ex.id}`)
  await expect(page.locator('.hero')).toHaveClass(/is-ghost/)

  // The person gives the ✓.
  await page.locator('.hero [data-accept-change]').click()
  await expect.soft(page.locator('.hero'), 'excerpt no longer a ghost').not.toHaveClass(/is-ghost/)
  await expect.soft(page.locator('.hero [data-accept-change]')).toHaveCount(0)

  // The card view shows the excerpt as supporting evidence, with text, speaker and session.
  await page.goto(`${server.url}/map/logcard`)
  const evidence = page.locator('#sections section').filter({ has: page.getByRole('heading', { name: 'Evidence' }) })
  const row = evidence.locator(`[data-go="${ex.id}"]`)
  await expect.soft(row, 'excerpt under the card as evidence').toBeVisible()
  console.log('06.5 evidence row text:', JSON.stringify(await row.innerText().catch(() => '')))
  await expect.soft(row, 'quoted text').toContainText(sentence)
  await expect.soft(row, 'speaker').toContainText(/\b(you|user)\b/i)
  await expect.soft(row, 'session').toContainText('sess-0605')
  await page.screenshot({ path: join(import.meta.dirname, 'test-results', 'q065-card.png'), fullPage: true })
})
