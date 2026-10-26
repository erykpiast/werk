import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { setup } from './common.ts'
import type { Project } from './helpers.ts'

const SESSION = 'a1b2c3d4-0000-4000-8000-000000000001'
const user = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const assistant = (text: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const meta = JSON.stringify({ type: 'summary', summary: 'a session' })

/** Writes a Claude Code transcript for the project under a private config dir. */
function transcript(p: Project, lines: string[]): void {
  const config = join(p.dir, '.claude-config')
  p.env.CLAUDE_CONFIG_DIR = config
  p.write(join('.claude-config', 'projects', p.dir.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`), lines.join('\n') + '\n')
}
const detail = (page: Page) => page.getByRole('region', { name: 'card detail' })

test('06.1 an exact quote becomes a ghost excerpt that cites its source', async ({ page }) => {
  const { p, s } = await setup((p) => {
    p.real('log', 'The log is the truth')
    transcript(p, [meta, assistant('Hello.'), user('I think the map is a view of the log, nothing more.'), assistant('Agreed.')])
  })
  await page.goto(`${s.url}/#log`)
  const cardBefore = (await (await fetch(`${s.url}/api/map`)).json()).cards.log
  const r = p.werk('quote', 'log', SESSION, '--text', 'the map is a view of the log')
  expect(r.code, r.out).toBe(0)
  const map = await (await fetch(`${s.url}/api/map`)).json()
  const ex = Object.values(map.cards).find((c: any) => c.kind === 'excerpt') as any
  expect(ex).toBeDefined()
  expect(ex.proposed).toBe(true)
  expect(ex.excerpt).toMatchObject({ speaker: 'user', session: SESSION, msgIndex: 2 })
  expect(map.ghostEdges).toContainEqual(expect.objectContaining({ from: 'log', to: ex.id, type: 'supported_by' }))
  expect(map.cards.log).toEqual(cardBefore)
  const item = detail(page).getByRole('region', { name: 'evidence' }).getByRole('listitem')
  await expect(item).toHaveClass(/ghost/)
  await expect(item).toContainText('the map is a view of the log')
  await expect(item).toContainText('proposed')
  await expect(item).toContainText(`user, message 2 of session ${SESSION}`)
  await expect(item.getByRole('button', { name: `accept #${ex.id}` })).toBeVisible()
})

test('06.2 the excerpt span selects the quoted text exactly', async ({ page }) => {
  const sentence = 'Every change is a new event in the log.'
  const paragraph = `The map has one source of truth. ${sentence} A view only reads the fold.`
  const { p, s } = await setup((p) => {
    p.real('log', 'The log is the truth')
    transcript(p, [user('How do edits work?'), assistant(paragraph)])
  })
  const r = p.werk('quote', 'log', SESSION, '--text', sentence)
  expect(r.code, r.out).toBe(0)
  const map = await (await fetch(`${s.url}/api/map`)).json()
  const ex = Object.values(map.cards).find((c: any) => c.kind === 'excerpt') as any
  // The person opens the transcript at the recorded message and span.
  const { readFileSync } = await import('node:fs')
  const file = readFileSync(join(p.env.CLAUDE_CONFIG_DIR!, 'projects', p.dir.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`), 'utf8')
  const line = JSON.parse(file.split('\n')[ex.excerpt.msgIndex])
  const content = line.message.content
  const text = typeof content === 'string' ? content : content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  expect(text.slice(ex.excerpt.span[0], ex.excerpt.span[1])).toBe(sentence)
  expect(ex.excerpt.speaker).toBe('assistant')
  await page.goto(`${s.url}/#${encodeURIComponent(ex.id)}`)
  await expect(detail(page).getByLabel('pointer')).toContainText(`assistant, message ${ex.excerpt.msgIndex} of session ${SESSION}`)
})

test('06.3 a quote with one changed character fails and writes nothing', async ({ page }) => {
  const { p, s } = await setup((p) => {
    p.real('views', 'Views only read')
    transcript(p, [user('Rule: No view edits a drawn card in place.'), assistant('Noted.')])
  })
  await page.goto(`${s.url}/#views`)
  const before = p.log()
  const r = p.werk('quote', 'views', SESSION, '--text', 'No view edits a drawn card in places.')
  expect(r.code).not.toBe(0)
  expect(r.out).toMatch(/no exact match/)
  expect(p.log()).toBe(before)
  const map = await (await fetch(`${s.url}/api/map`)).json()
  expect(Object.values(map.cards).some((c: any) => c.kind === 'excerpt')).toBe(false)
  expect([...map.links, ...map.ghostEdges].some((l: any) => l.type === 'supported_by')).toBe(false)
  await expect(detail(page).getByRole('region', { name: 'evidence' })).toHaveCount(0)
})

test('06.4 a quote that occurs in two messages fails and names the ambiguity', async ({ page }) => {
  const { p, s } = await setup((p) => {
    p.real('guess', 'No guessing')
    transcript(p, [user('Remember: the tool never guesses what I mean.'), assistant('Yes, the tool never guesses; it asks.')])
  })
  await page.goto(`${s.url}/#guess`)
  const before = p.log()
  const r = p.werk('quote', 'guess', SESSION, '--text', 'the tool never guesses')
  expect(r.code).not.toBe(0)
  expect(r.out).toMatch(/ambiguous/)
  expect(r.out).toMatch(/occurs in 2 messages/)
  expect(p.log()).toBe(before)
  await expect(detail(page).getByRole('region', { name: 'evidence' })).toHaveCount(0)
})

test('06.5 an accepted excerpt shows in the card view with speaker and session', async ({ page }) => {
  const sentence = 'Only the person accepts a proposal.'
  const { p, s } = await setup((p) => {
    p.real('accept', 'Accepting is manual')
    transcript(p, [user('Hi.'), assistant(`Here is the rule. ${sentence}`)])
    p.ok('quote', 'accept', SESSION, '--text', sentence)
  })
  await page.goto(`${s.url}/#accept`)
  const ev = detail(page).getByRole('region', { name: 'evidence' })
  const item = ev.getByRole('listitem')
  await expect(item).toHaveClass(/ghost/)
  await item.getByRole('button', { name: /^accept #/ }).click()
  await expect(item).not.toHaveClass(/ghost/)
  await expect(item).not.toContainText('proposed')
  await page.reload()
  await expect(ev.getByRole('heading')).toHaveText('Evidence')
  await expect(item).toContainText(sentence)
  await expect(item).toContainText('assistant')
  await expect(item).toContainText(SESSION)
})
