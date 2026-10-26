import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, MAIN, test, type Werk } from './harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`

const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

const GHOST_COLOR = 'rgb(138, 138, 138)'

test.describe('fixture', () => {
  test.use({ seed: 'fixture' })

  test('69.1 The map shows the fixture project as a refines tree', async ({ page, werk }) => {
    // Fixture: root "werk"; children "log" and "map" refine it; "fold" refines "log".
    await page.goto(werk.url)
    const map = page.getByRole('list', { name: 'map' })
    await expect(map.locator(`> ${card('werk')} > a`)).toContainText('werk: a visual layer over Claude Code')
    await expect(map.locator(`> ${card('werk')} > ul > ${card('log')} > a`)).toContainText('Store the map as an append-only event log')
    await expect(map.locator(`> ${card('werk')} > ul > ${card('map')} > a`)).toContainText('Draw the map in a browser')
    await expect(map.locator(`> ${card('werk')} > ul > ${card('log')} > ul > ${card('fold')} > a`)).toContainText(
      'Fold the cards from the log',
    )
    await expect(map.locator(`> ${card('werk')} > ul > ${card('fold')}`)).toHaveCount(0)
  })

  test('69.4 A second server on the same project waits, then refuses', async ({ page, werk }) => {
    await page.goto(werk.url)
    const map = page.getByRole('list', { name: 'map' })
    await expect(map.locator('li')).toHaveCount(7)
    const before = await map.innerText()
    const lock = JSON.parse(readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')) as { pid: number }

    const started = Date.now()
    const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env: werk.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let sawWaitAt = -1
    second.stdout.on('data', (c: Buffer) => (out += c.toString()))
    second.stderr.on('data', (c: Buffer) => {
      out += c.toString()
      if (sawWaitAt < 0 && /wait/i.test(out)) sawWaitAt = Date.now() - started
    })
    const code = await new Promise<number | null>((resolve) => {
      const t = setTimeout(() => {
        second.kill('SIGKILL')
        resolve(-999)
      }, 15_000)
      second.on('exit', (c) => {
        clearTimeout(t)
        resolve(c)
      })
    })
    const elapsed = Date.now() - started
    console.log(`69.4 second server: code=${code} elapsed=${elapsed}ms waitSeenAt=${sawWaitAt}ms output:\n${out}`)

    expect(out).toMatch(new RegExp(`wait[^\\n]*\\b${lock.pid}\\b`, 'i'))
    expect(code).not.toBe(0)
    expect(code).not.toBe(-999)
    expect(elapsed).toBeLessThan(8_000)
    const afterWait = out.slice(out.search(/wait/i))
    expect(afterWait.split('\n').slice(1).join('\n')).toContain(String(lock.pid))

    await page.goto(werk.url)
    await expect(map.locator('li')).toHaveCount(7)
    expect(await map.innerText()).toBe(before)
  })
})

test('69.2 A card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  werk.cli(['add', 'root', '--title', 'The root card'])
  werk.cli(['accept', 'root', '--actor', 'you'])
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('root')}`)).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)

  let navigations = 0
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navigations++
  })
  werk.cli(['add', 'alog', '--title', 'Use an append-only log', '--parent', 'root'])
  werk.cli(['accept', 'alog', '--actor', 'you'])

  const tile = map.locator(`> ${card('root')} > ul > ${card('alog')}`)
  await expect(tile.locator('> a')).toContainText('Use an append-only log', { timeout: 5_000 })
  await expect(tile).toHaveAttribute('data-proposed', 'false', { timeout: 5_000 })
  expect(navigations).toBe(0)
})

test('69.3 The open card survives a reload and has no control that edits its text', async ({ page, werk }) => {
  werk.cli(['add', 'root', '--title', 'The root card'])
  werk.cli(['add', 'kid', '--title', 'A child card', '--body', 'The body of the child.', '--parent', 'root'])
  werk.cli(['accept', 'kid', '--actor', 'you'])
  await page.goto(werk.url)
  await page.getByRole('list', { name: 'map' }).locator(`${card('kid')} > a`).click()

  await expect(page).toHaveURL(/#kid$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'kid')
  await expect(detail.getByRole('heading', { name: 'A child card' })).toBeVisible()
  await expect(detail).toContainText('The body of the child.')
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('input, textarea, select, [contenteditable=""], [contenteditable="true"]')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)

  await page.reload()
  await expect(page).toHaveURL(/#kid$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'kid')
  await expect(page.getByTestId('card').getByRole('heading', { name: 'A child card' })).toBeVisible()
})

async function payments(werk: Werk) {
  werk.cli(['add', 'payments', '--title', 'Payments'])
  werk.cli(['accept', 'payments', '--actor', 'you'])
}

test('70.1 A proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  await payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  const ghost = map.locator(`> ${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(ghost).toContainText('Refunds')
  await expect(ghost).toHaveCSS('border-top-style', 'dashed')
  await expect(ghost).toHaveCSS('color', GHOST_COLOR)
  const real = map.locator(`> ${card('payments')} > a`)
  await expect(real).not.toHaveCSS('border-top-style', 'dashed')
  await expect(real).not.toHaveCSS('color', GHOST_COLOR)
})

test('70.2 The person accepts one ghost with the ✓ button and it becomes real', async ({ page, werk }) => {
  await payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('payments')} > ul > ${card('refunds')} > a`)).toHaveCSS('border-top-style', 'dashed')

  await map.locator(`${card('refunds')} > a`).click()
  const before = logLines(werk).length
  await page.getByRole('button', { name: '✓' }).click()
  await expect(page.getByRole('button', { name: '✓' })).toHaveCount(0)
  const lines = logLines(werk)
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })

  await page.getByRole('link', { name: 'The map' }).click()
  const tile = map.locator(`> ${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(tile).not.toHaveCSS('border-top-style', 'dashed')
  await expect(tile).not.toHaveCSS('color', GHOST_COLOR)
})

test('70.3 Accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  await payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  await map.locator(`${card('partial')} > a`).click()
  await page.getByRole('button', { name: '✓' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')

  await page.getByRole('link', { name: 'The map' }).click()
  const r = map.locator(`> ${card('payments')} > ul > ${card('refunds')}`)
  const p = r.locator(`> ul > ${card('partial')}`)
  await expect(p.locator('> a')).toContainText('Partial refunds')
  await expect(p.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  await expect(p).toHaveAttribute('data-proposed', 'false')
  await expect(r.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  await expect(r).toHaveAttribute('data-proposed', 'false')
})

test('70.4 An accept takes only the accepted card\'s branch, not other ghosts', async ({ page, werk }) => {
  await payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'opt', '--kind', 'option', '--title', 'Refund by store credit'])
  werk.cli(['link', 'opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'src', '--kind', 'source', '--title', 'Card network refund rules'])
  werk.cli(['link', 'refunds', 'src', '--type', 'supported_by'])
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  await expect(page.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /accept all|accept both/i })).toHaveCount(0)

  await map.locator(`${card('refunds')} > a`).click()
  await page.getByRole('button', { name: '✓' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')

  await page.getByRole('link', { name: 'The map' }).click()
  await expect(map.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(map.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  await expect(map.locator(card('opt'))).toHaveAttribute('data-proposed', 'false')
  await expect(map.locator(`${card('opt')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  await expect(map.locator(card('src'))).toHaveAttribute('data-proposed', 'false')
  await expect(map.locator(`${card('src')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  const cb = map.locator(`${card('chargebacks')} > a`)
  await expect(cb).toHaveCSS('border-top-style', 'dashed')
  await expect(cb).toHaveCSS('color', GHOST_COLOR)
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('70.5 A second view sees the accept because it reads the same log', async ({ page, werk }) => {
  await payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(werk.url)
  const second = await page.context().newPage()
  await second.goto(werk.url)
  const map1 = page.getByRole('list', { name: 'map' })
  const map2 = second.getByRole('list', { name: 'map' })
  await expect(map1.locator(`${card('refunds')} > a`)).toHaveCSS('border-top-style', 'dashed')
  await expect(map2.locator(`${card('refunds')} > a`)).toHaveCSS('border-top-style', 'dashed')

  await map1.locator(`${card('refunds')} > a`).click()
  await page.getByRole('button', { name: '✓' }).click()

  await expect(map2.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false', { timeout: 5_000 })
  await expect(map2.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  await second.close()
})
