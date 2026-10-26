import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'
import { card, logLines, real } from './util.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')

test('69.1 the map shows the fixture project as a refines tree', async ({ page, werk }) => {
  real(werk, 'r', 'Root card')
  real(werk, 'c1', 'Child one', ['--parent', 'r'])
  real(werk, 'c2', 'Child two', ['--parent', 'r'])
  real(werk, 'gc', 'Grandchild', ['--parent', 'c1'])
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('r')} > a`)).toContainText('Root card')
  await expect(map.locator(`> ${card('r')} > ul > ${card('c1')} > a`)).toContainText('Child one')
  await expect(map.locator(`> ${card('r')} > ul > ${card('c2')} > a`)).toContainText('Child two')
  await expect(map.locator(`> ${card('r')} > ul > ${card('c1')} > ul > ${card('gc')} > a`)).toContainText('Grandchild')
  await expect(map.locator(`> ${card('r')} > ul > ${card('gc')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { stillSamePage: true }))
  werk.cli(['add', 'aol', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'aol', '--actor', 'you'])
  const drawn = page.locator(`${card('werk')} > ul > ${card('aol')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5_000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5_000 })
  expect(await page.evaluate(() => (window as { stillSamePage?: boolean }).stillSamePage)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  await page.locator(`${card('map')} > a`).click()
  await expect(page).toHaveURL(/#map$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Draw the map in a browser')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/#map$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'map')
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  test.setTimeout(60_000)
  const lock = JSON.parse(readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')) as { pid: number }
  await expect(page.locator(card('werk'))).toBeVisible()
  const before = await page.locator('li[data-card-id]').count()
  const started = Date.now()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], {
    cwd: werk.dir,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let err = ''
  second.stderr.on('data', (c: Buffer) => (err += c.toString()))
  const code = await new Promise<number | null>((resolve) => {
    const t = setTimeout(() => {
      second.kill('SIGKILL')
      resolve(null)
    }, 20_000)
    second.on('exit', (c) => {
      clearTimeout(t)
      resolve(c)
    })
  })
  const elapsed = Date.now() - started
  console.log('second server stderr:', err, 'exit', code, 'elapsed', elapsed)
  expect(err).toContain(`waiting for pid ${lock.pid}`)
  expect(code).not.toBe(0)
  expect(code).not.toBeNull()
  expect(elapsed).toBeLessThan(9_000)
  const lines = err.split('\n').filter((l) => !l.includes('waiting'))
  expect(lines.join('\n')).toContain(`pid ${lock.pid}`)
  await page.goto(werk.url)
  await expect(page.locator('li[data-card-id]')).toHaveCount(before)
  await expect(page.locator(card('werk'))).toBeVisible()
})

test('69.5 make e2e runs the specs and leaves one screenshot per test', async () => {
  test.setTimeout(600_000)
  const logBefore = readFileSync(join(ROOT, 'e2e', 'fixture-project', '.werk', 'log.jsonl'), 'utf8')
  const r = spawnSync('make', ['e2e'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CI: 'true' }, timeout: 580_000 })
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '')
  console.log(out.slice(-3000))
  expect(r.status).toBe(0)
  const results = [...new Set(out.split(/[\r\n]/).filter((l) => /[✓✘]\s+\d+ \[chromium\]/.test(l)).map((l) => /\d+ \[chromium\].*?\.spec\.ts:\d+/.exec(l)![0]))]
  const passed = /(\d+) passed/.exec(out)
  expect(passed).not.toBeNull()
  const ran = Number(passed![1]) + Number(/(\d+) failed/.exec(out)?.[1] ?? 0)
  expect(results.length).toBe(ran)
  const dir = join(ROOT, 'test-results')
  const shots = readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory() && existsSync(join(dir, d, 'evidence.png')))
  expect(shots.length).toBe(ran)
  expect(readFileSync(join(ROOT, 'e2e', 'fixture-project', '.werk', 'log.jsonl'), 'utf8')).toBe(logBefore)
  const status = spawnSync('git', ['status', '--porcelain', '--', 'e2e', 'src', '.werk'], { cwd: ROOT, encoding: 'utf8' })
  expect(status.stdout.trim()).toBe('')
  expect(existsSync(join(ROOT, '.werk', 'log.jsonl'))).toBe(false)
  void logLines
})
