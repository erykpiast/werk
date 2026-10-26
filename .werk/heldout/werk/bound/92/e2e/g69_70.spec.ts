/** Held-out steps 69.x and 70.x. */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const card = (id: string) => `li[data-card-id="${id}"]`
const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

// 69.1: fixture root "werk"; children "log" and "map" refine it; grandchild "fold" refines "log".
test('69.1 the map shows the fixture project as a refines tree', async ({ page }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('werk')} > a`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('log')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('map')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('log')} > ul > ${card('fold')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('fold')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the CLI appears with no reload', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  await expect(page.getByText('Use an append-only log', { exact: false })).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutNoReload: true }))
  werk.cli(['add', 'aol', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'aol', '--actor', 'you'])
  const drawn = page.locator(`${card('werk')} > ul > ${card('aol')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { heldoutNoReload?: boolean }).heldoutNoReload)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  await page.locator(`${card('map')} > a`).click()
  await expect(page).toHaveURL(/#map$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Draw the map in a browser')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/#map$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'map')
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  const lock = JSON.parse(readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')) as { pid: number }
  const env = { ...process.env, WERK_LOG: '' }
  const started = Date.now()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  let out = ''
  second.stderr.on('data', (c: Buffer) => (err += c.toString()))
  second.stdout.on('data', (c: Buffer) => (out += c.toString()))
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
  const took = Date.now() - started
  console.log('69.4 second server', { code, took, err, out })
  expect(err).toContain(`waiting for pid ${lock.pid}`)
  expect(code).not.toBe(0)
  expect(code).not.toBe(-999)
  expect(took).toBeLessThan(8000)
  const lines = err.split('\n')
  const errorLine = lines.find((l) => !l.includes('waiting') && l.includes(String(lock.pid)))
  expect(errorLine).toBeTruthy()
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator('li')).toHaveCount(7)
  await expect(map.locator(`> ${card('werk')} > a`)).toContainText('werk: a visual layer over Claude Code')
})

test('69.5 make e2e in a fresh clone runs specs and leaves one screenshot per test', async () => {
  test.setTimeout(600_000)
  const tmp = mkdtempSync(join(tmpdir(), 'heldout-69-5-'))
  const clone = join(tmp, 'werk')
  const c = spawnSync('git', ['clone', '--quiet', ROOT, clone], { encoding: 'utf8' })
  expect(c.status).toBe(0)
  const logFile = join(clone, '.werk', 'log.jsonl')
  const logBefore = existsSync(logFile) ? readFileSync(logFile, 'utf8') : null
  const env = { ...process.env }
  delete env.WERK_LOG
  const r = spawnSync('make', ['e2e'], { cwd: clone, encoding: 'utf8', env, timeout: 540_000 })
  const output = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '\n')
  console.log('69.5 make e2e status', r.status, output.slice(-3000))
  expect(r.status).toBe(0)
  const results = [...new Set(output.split('\n').filter((l) => /(✓|✘)\s+\d+ \[chromium\]/.test(l)).map((l) => /\d+ \[chromium\]/.exec(l)![0]))]
  expect(results.length).toBeGreaterThan(0)
  const ran = Number(/(\d+) passed/.exec(output)?.[1] ?? 0) + Number(/(\d+) failed/.exec(output)?.[1] ?? 0)
  expect(results.length).toBe(ran)
  const dir = join(clone, 'test-results')
  const shots: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (f === 'evidence.png') shots.push(p)
    }
  }
  walk(dir)
  console.log('69.5 tests', ran, 'screenshots', shots.length)
  expect(shots.length).toBe(ran)
  const logAfter = existsSync(logFile) ? readFileSync(logFile, 'utf8') : null
  expect(logAfter).toBe(logBefore)
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: clone, encoding: 'utf8' }).stdout
  expect(status).not.toContain('.werk/')
})

/** A real card "Payments" under the root. */
function payments(werk: Werk) {
  werk.cli(['add', 'payments', '--title', 'Payments', '--parent', 'werk'])
  werk.cli(['accept', 'payments', '--actor', 'you'])
}

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(werk.url)
  const ghost = page.locator(`${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(ghost).toContainText('Refunds')
  await expect(ghost).toHaveCSS('border-top-style', 'dashed')
  await expect(ghost).toHaveCSS('color', 'rgb(138, 138, 138)')
  const real = page.locator(`${card('payments')} > a`)
  await expect(real).not.toHaveCSS('border-top-style', 'dashed')
  await expect(real).not.toHaveCSS('color', 'rgb(138, 138, 138)')
})

test('70.2 the person accepts one ghost with ✓ and it becomes real', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(werk.url)
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${card('refunds')} > a`).click()
  const before = logLines(werk).length
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const lines = logLines(werk)
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await expect(page.getByRole('button', { name: /Accept/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'Map', exact: true }).click()
  const tile = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  await expect(tile).toHaveAttribute('data-proposed', 'false')
  await expect(tile.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(`${werk.url}#partial`)
  await page.getByRole('button', { name: 'Accept #partial' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('link', { name: 'Map', exact: true }).click()
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  const partial = refunds.locator(`> ul > ${card('partial')}`)
  await expect(partial).toHaveAttribute('data-proposed', 'false')
  await expect(refunds).toHaveAttribute('data-proposed', 'false')
  await expect(partial.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  await expect(refunds.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.4 an accept takes only the accepted card branch', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'opt-store', '--kind', 'option', '--title', 'Store credit only', '--why-not', 'People want money back'])
  werk.cli(['link', 'opt-store', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'src-policy', '--kind', 'source', '--title', 'Refund policy doc'])
  werk.cli(['link', 'refunds', 'src-policy', '--type', 'supported_by'])
  await page.goto(werk.url)
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  // The map shows no control that accepts several ghosts together.
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.locator(`${card('refunds')} > a`).click()
  await expect(page.getByRole('button')).toHaveCount(1)
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#opt-store`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#src-policy`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  const cb = page.locator(`${card('payments')} > ul > ${card('chargebacks')}`)
  await expect(cb).toHaveAttribute('data-proposed', 'true')
  await expect(cb.locator('> a')).toHaveCSS('border-top-style', 'dashed')
  await expect(cb.locator('> a')).toHaveCSS('color', 'rgb(138, 138, 138)')
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept', async ({ page, werk }) => {
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'werk'])
  const second = await page.context().newPage()
  await second.goto(werk.url)
  await page.goto(`${werk.url}#refunds`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'true')
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(second.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  await second.close()
})
