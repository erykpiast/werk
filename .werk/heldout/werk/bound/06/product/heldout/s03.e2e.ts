import { expect, test, type Page } from '@playwright/test'
import { ctx, Project, setup } from './common.ts'

/** Turns a printed fix command `werk <verb> ...` into argv, filling each <placeholder>. */
function argvOf(command: string, fill: (placeholder: string) => string): string[] {
  const filled = command.replace(/<[^>]+>/g, (m) => fill(m))
  const words = filled.match(/"[^"]*"|\S+/g)!.map((w) => (w.startsWith('"') ? w.slice(1, -1) : w))
  expect(words[0]).toBe('werk')
  return words.slice(1)
}
const fixLines = (out: string) => out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('werk ') && !l.startsWith('werk:'))
const statusOn = (page: Page) => page.getByRole('region', { name: 'card detail' }).locator('.meta .status').first()

test('03.1 a missing kill criterion blocks decided, and the printed command fixes it', async ({ page }) => {
  const { p, s } = await setup((p) => {
    p.decided('basis', 'Storage is a log')
    p.real('card', 'Cards fold from the log', '--who', 'you')
    p.ok('link', 'card', 'basis', '--type', 'depends_on', '--why', 'folds the log')
    p.ok('add', 'card:opt0', '--kind', 'option', '--title', 'A database table', '--why-not', 'loses history', '--alternative-to', 'card')
    p.ok('accept', 'card:opt0', '--actor', 'you')
  })
  const before = p.log()
  const r = p.werk('decide', 'card')
  expect(r.code).not.toBe(0)
  expect(r.out).toMatch(/kill criterion/)
  const fixes = fixLines(r.out)
  expect(fixes.length).toBe(1)
  expect(fixes[0]).toMatch(/^werk kill card /)
  await page.goto(`${s.url}/#card`)
  await expect(statusOn(page)).toHaveText('open')
  expect(p.log()).toBe(before)
  const run = p.werk(...argvOf(fixes[0]!, () => 'a reader needs random access'))
  expect(run.code, run.out).toBe(0)
  const again = p.werk('decide', 'card')
  expect(again.code, again.out).toBe(0)
  await expect(statusOn(page)).toHaveText('decided')
})

test('03.2 each missing fact prints its own fixing command', async ({ page }) => {
  const ids = ['c-who', 'c-basis', 'c-opts', 'c-kill']
  const { p, s } = await setup((p) => {
    p.decided('base', 'The base decision')
    for (const id of ids) {
      p.real(id, `Card ${id}`, ...(id === 'c-who' ? [] : ['--who', 'you']))
      if (id !== 'c-basis') p.ok('link', id, 'base', '--type', 'depends_on', '--why', 'needs the base')
      if (id !== 'c-opts') {
        p.ok('add', `${id}:opt0`, '--kind', 'option', '--title', 'Another way', '--why-not', 'worse', '--alternative-to', id)
        p.ok('accept', `${id}:opt0`, '--actor', 'you')
      }
      if (id !== 'c-kill') p.ok('kill', id, 'revisit when the base changes')
    }
  })
  const fixes: Record<string, string> = {}
  for (const id of ids) {
    const before = p.log()
    const r = p.werk('decide', id)
    expect(r.code, `${id}: ${r.out}`).not.toBe(0)
    expect(p.log()).toBe(before)
    const lines = fixLines(r.out)
    expect(lines.length, `${id}: ${r.out}`).toBe(1)
    fixes[id] = lines[0]!
  }
  expect(new Set(Object.values(fixes)).size).toBe(4)
  expect(fixes['c-who']).toMatch(/^werk edit c-who --who /)
  expect(fixes['c-basis']).toMatch(/^werk link c-basis .* --type depends_on/)
  expect(fixes['c-opts']).toMatch(/^werk add c-opts:opt\d+ --kind option .*--alternative-to c-opts/)
  expect(fixes['c-kill']).toMatch(/^werk kill c-kill /)
  const fill: Record<string, (ph: string) => string> = {
    'c-who': () => 'me',
    'c-basis': (ph) => (ph === '<card-it-needs>' ? 'base' : 'it needs the base'),
    'c-opts': (ph) => (ph.includes('alternative') ? 'Keep it as it is' : 'it costs more'),
    'c-kill': () => 'revisit when the base changes',
  }
  const results: Record<string, string> = {}
  for (const id of ids) {
    const run = p.werk(...argvOf(fixes[id]!, fill[id]!))
    const again = p.werk('decide', id)
    results[id] = `fix exit ${run.code}; decide exit ${again.code}: ${(run.out + again.out).trim()}`
  }
  for (const id of ids) {
    await page.goto(`${s.url}/#${id}`)
    await expect.soft(statusOn(page), `${id}: ${results[id]}`).toHaveText('decided')
  }
})

test('03.3 a stated lack of basis and an unchallenged flag satisfy the check', async ({ page }) => {
  const { p, s } = await setup((p) => {
    p.real('card', 'Ship one binary', '--who', 'you')
    p.ok('kill', 'card', 'a second platform appears')
  })
  expect(p.werk('edit', 'card', '--no-basis', 'it is the first decision of the project').code).toBe(0)
  expect(p.werk('edit', 'card', '--unchallenged', 'nobody proposed another way').code).toBe(0)
  const r = p.werk('decide', 'card')
  expect(r.code, r.out).toBe(0)
  await page.goto(`${s.url}/#card`)
  await expect(statusOn(page)).toHaveText('decided')
  const detail = page.getByRole('region', { name: 'card detail' })
  await expect.soft(detail, 'the stated no-basis reason is visible').toContainText('it is the first decision of the project')
  await expect.soft(detail, 'the unchallenged flag is visible').toContainText(/unchallenged/i)
})

test('03.4 an amend of a decided card cannot remove a required fact', async ({ page }) => {
  const { p, s } = await setup((p) => p.decided('card', 'Ship one binary', '--body', 'The first text.'))
  await page.goto(`${s.url}/#card`)
  await expect(statusOn(page)).toHaveText('decided')
  // There is no verb that removes a kill criterion; look for one in the help text.
  const help = p.werk('help').stdout
  const removeKill = help.split('\n').find((l) => /kill/.test(l) && /remove|unset|clear|drop|--no-kill/.test(l))
  const amendBody = p.werk('edit', 'card', '--body', 'The new text.')
  expect(amendBody.code, amendBody.out).toBe(0)
  await expect(page.getByRole('region', { name: 'card detail' }).locator('.body')).toHaveText('The new text.')
  expect(removeKill, `no command in werk help removes a kill criterion:\n${help}`).toBeDefined()
})

test('03.5 adding a card and setting it open are not checked', async ({ page }) => {
  const { p, s } = await setup()
  const add = p.werk('add', 'card', '--title', 'Ship one binary', '--body', 'One file to install.')
  expect(add.code, add.out).toBe(0)
  await page.goto(`${s.url}/#card`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ship one binary')
  const open = p.werk('status', 'card', 'open')
  const openWithReason = p.werk('status', 'card', 'open', '--reason', 'postponed', '--why', 'not now')
  expect.soft(open.code === 0 || openWithReason.code === 0, `status open: ${open.out} | with a reason: ${openWithReason.out}`).toBe(true)
  await expect(statusOn(page)).toHaveText('open')
  const before = p.log()
  const decide = p.werk('status', 'card', 'decided')
  expect(decide.code).not.toBe(0)
  expect(p.log()).toBe(before)
  await expect(statusOn(page)).toHaveText('open')
})
