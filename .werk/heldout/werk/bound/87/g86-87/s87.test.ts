/** Held-out steps 87.1–87.5. */
import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { foldBoard } from '../../src/board/fold.ts'
import { authorOf, binderOf, judges, project, ticketOf, writes, type Ctx } from './common.ts'
import { openBrowser } from './browser.ts'

let c: Ctx | undefined
let closeBrowser: (() => Promise<void>) | undefined
afterEach(async () => {
  await closeBrowser?.()
  closeBrowser = undefined
  c?.p.run(['git', 'worktree', 'prune'])
  c?.p.cleanup()
  c = undefined
})

const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees HO87-MARK'
const author = authorOf(STEP)
const mainLine = (x: Ctx) => x.git('log', '--first-parent', '--format=%s', 'main').split('\n')

test('87.1 two green tickets merge onto the main line one after the other', () => {
  const x = (c = project('check:\n\t@true\n', { 'notes.txt': 'notes\n' }, [ticketOf(3), ticketOf(4)]))
  const branchesBefore = x.git('branch', '--format=%(refname:short)').split('\n')
  x.p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t3.txt'), writes('t4.txt')], 'heldout-author': author, 'heldout-binder': [binderOf({ '3.1': 'true' }), binderOf({ '3.1': 'true', '4.1': 'true' })] },
  })
  const r = x.p.werk(['run', 'root'])
  expect(r.code).toBe(0)
  expect(x.movesOf(3)).toEqual(['building', 'merging', 'done'])
  expect(x.movesOf(4)).toEqual(['building', 'merging', 'done'])
  const merges = mainLine(x).filter((s) => s.startsWith('werk: merge ticket'))
  expect(merges.map((s) => s.split(' (')[0])).toEqual(['werk: merge ticket 4', 'werk: merge ticket 3'])
  const branches = x.git('branch', '--format=%(refname:short)').split('\n')
  const newOnes = branches.filter((b) => !branchesBefore.includes(b))
  for (const b of newOnes) expect(b).toMatch(/^werk-build\//)
  // The board's held-out badge renders for each entry of a ticket's followUps (web/src/BoardView.tsx).
  for (const t of x.tickets()) expect(t.followUps).toEqual([])
}, 60_000)

test('87.2 a ticket red on the merged tree goes back to building and the main line stays where it was', async () => {
  // The check is red on a merge tree (detached HEAD) that holds the work of both tickets.
  const MAKEFILE = 'check:\n\t@if [ -f t3.txt ] && [ -f t4.txt ] && ! git symbolic-ref -q HEAD >/dev/null; then echo "HO87-MERGE-RED-OUTPUT"; exit 1; fi\n'
  const x = (c = project(MAKEFILE, { 'notes.txt': 'notes\n' }, [ticketOf(3)]))
  x.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t3.txt')], 'heldout-author': author, 'heldout-binder': binderOf({ '3.1': 'true' }) } })
  expect(x.p.werk(['run', 'root']).code).toBe(0)
  expect(x.columnOf(3)).toBe('done')

  x.appendBoard({ type: 'ticket.planned', payload: ticketOf(4) })
  x.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t4.txt')], 'heldout-author': author, 'heldout-binder': binderOf({ '3.1': 'true', '4.1': 'true' }) } })
  const tip = x.git('rev-parse', 'main')
  const r = x.p.werk(['run', 'root', '--cap', '1'])
  expect(r.stdout).toContain('merging 4: red at make check')
  expect(x.movesOf(4)).toEqual(['building', 'merging', 'building'])
  expect(x.columnOf(4)).toBe('building')
  expect(x.git('rev-parse', 'main')).toBe(tip)

  // The drawer of the second ticket, in the browser.
  const b = await openBrowser(x.p)
  closeBrowser = b.close
  await b.page.goto(`${b.url}#/board/4`)
  const drawer = b.page.getByRole('region', { name: 'drawer' })
  await drawer.waitFor()
  const text = await drawer.innerText()
  expect(text).toContain('make check')
  expect(text).toContain('HO87-MERGE-RED-OUTPUT')
}, 90_000)

test('87.3 a merge moves a clean checkout and stops at a checkout with a blocking local change', () => {
  const x = (c = project('check:\n\t@true\n', { 'notes.txt': 'notes\n' }, [ticketOf(3)]))
  x.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('notes.txt', 'ticket three\n')], 'heldout-author': author, 'heldout-binder': binderOf({ '3.1': 'true' }) } })
  expect(x.p.werk(['run', 'root']).code).toBe(0)
  expect(readFileSync(join(x.p.dir, 'notes.txt'), 'utf8')).toBe('ticket three\n')

  writeFileSync(join(x.p.dir, 'notes.txt'), 'my own edit\n')
  x.appendBoard({ type: 'ticket.planned', payload: ticketOf(4) })
  x.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('notes.txt', 'ticket four\n')], 'heldout-author': author, 'heldout-binder': binderOf({ '3.1': 'true', '4.1': 'true' }) } })
  const tip = x.git('rev-parse', 'main')
  const r = x.p.werk(['run', 'root'])
  expect(r.code).not.toBe(0)
  expect(x.movesOf(4)).toContain('merging')
  expect(x.columnOf(4)).not.toBe('done')
  expect(x.git('rev-parse', 'main')).toBe(tip)
  expect(readFileSync(join(x.p.dir, 'notes.txt'), 'utf8')).toBe('my own edit\n')
}, 90_000)

test('87.4 a red held-out step after a merge files a follow-up and shows a badge on the done ticket', async () => {
  // The follow-up's build stays red (it writes stop.txt), so the run stops while the follow-up is open.
  const MAKEFILE = 'check:\n\t@if [ -f stop.txt ]; then echo stop; exit 1; fi\n'
  const x = (c = project(MAKEFILE, { 'notes.txt': 'notes\n' }, [ticketOf(3)]))
  x.p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t3.txt'), writes('stop.txt')], 'heldout-author': author, 'heldout-binder': [binderOf({ '3.1': 'false' })] },
  })
  const r = x.p.werk(['run', 'root', '--cap', '1'])
  expect(r.stdout).toMatch(/merged 3 /)
  expect(x.columnOf(3)).toBe('done')
  expect(mainLine(x).some((s) => s.startsWith('werk: merge ticket 3'))).toBe(true)
  const all = x.events()
  const filed = all.findIndex((e) => e.type === 'heldout.followup')
  expect(filed).toBeGreaterThan(-1)
  const fu = (all[filed]!.payload as { number: number }).number
  const then = foldBoard(all.slice(0, filed + 1)).columns.flatMap((t) => t.tickets)
  const follow = then.find((t) => t.number === fu)!
  expect(follow.column).toBe('ready')
  expect(follow.brief).toContain(STEP)

  const b = await openBrowser(x.p)
  closeBrowser = b.close
  const page = b.page
  await page.goto(`${b.url}#/board`)
  const card = page.locator('li[data-ticket="3"]')
  await card.waitFor()
  await page.locator('li[data-ticket="3"] [data-badge="heldout"]').waitFor({ timeout: 5000 })
  await card.getByRole('link', { name: 'Ticket 3' }).click()
  const metadata = page.getByRole('region', { name: 'drawer' }).getByRole('complementary', { name: 'metadata' })
  await metadata.locator('[data-badge="heldout"]').waitFor({ timeout: 5000 })
  await metadata.locator('[data-badge="heldout"]').click()
  expect(page.url()).toMatch(new RegExp(`#/board/${fu}$`))
  await page.locator(`section[aria-label="drawer"][data-ticket="${fu}"]`).waitFor({ timeout: 5000 })
}, 90_000)

test('87.5 G2 opens after the last merge with all held-out steps green and opens again after a later merge', () => {
  const x = (c = project('check:\n\t@true\n', { 'notes.txt': 'notes\n' }, [ticketOf(3), ticketOf(4)]))
  x.p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t3.txt'), writes('t4.txt')], 'heldout-author': author, 'heldout-binder': [binderOf({ '3.1': 'true' }), binderOf({ '3.1': 'true', '4.1': 'true' })] },
  })
  expect(x.p.werk(['run', 'root']).code).toBe(0)
  const firstMerge = x.git('rev-parse', 'main~1')
  const gates = () => x.events().flatMap((e) => (e.type === 'gate.opened' ? [e.payload.commit] : []))
  // After the first merge G2 was not open for the subtree.
  expect(gates()).not.toContain(firstMerge)
  expect(gates()).toEqual([x.git('rev-parse', 'main')])
  // A new ticket of the same subtree later merges with every held-out step green.
  const firstGate = x.git('rev-parse', 'main')
  x.appendBoard({ type: 'ticket.planned', payload: ticketOf(5) })
  x.p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t5.txt')], 'heldout-author': author, 'heldout-binder': [binderOf({ '3.1': 'true', '4.1': 'true', '5.1': 'true' })] },
  })
  expect(x.p.werk(['run', 'root']).code).toBe(0)
  expect(gates()).toEqual([firstGate, x.git('rev-parse', 'main')])
  // The person approves G2: the product must offer a way to do it (checked last, so the later merge is observed too).
  const help = x.p.werk(['help']).stdout
  expect(help).toMatch(/approve/i)
}, 90_000)
