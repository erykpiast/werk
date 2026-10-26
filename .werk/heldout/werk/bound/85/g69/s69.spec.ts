import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { project, spawnServe, card, type Proj, type Server } from './werk.ts'

const li = (id: string) => `li[data-card-id="${id}"]`
const tree = () => [
  ...card('root', 'The root card'),
  ...card('child-a', 'Child A', { parent: 'root' }),
  ...card('child-b', 'Child B', { parent: 'root' }),
  ...card('grand', 'Grandchild of A', { parent: 'child-a' }),
]

let p: Proj
let s: Server | undefined
test.afterEach(async ({ page }, info) => {
  await page.screenshot({ path: info.outputPath('evidence.png'), fullPage: true }).catch(() => {})
  await s?.stop()
  s = undefined
  p?.cleanup()
})

test('69.1 the map shows the fixture project as a refines tree', async ({ page }) => {
  p = project(tree())
  s = await p.serve()
  await page.goto(s.url)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${li('root')} > a`)).toContainText('The root card')
  await expect(map.locator(`> ${li('root')} > ul > ${li('child-a')} > a`)).toContainText('Child A')
  await expect(map.locator(`> ${li('root')} > ul > ${li('child-b')} > a`)).toContainText('Child B')
  await expect(map.locator(`> ${li('root')} > ul > ${li('child-a')} > ul > ${li('grand')} > a`)).toContainText('Grandchild of A')
  await expect(map.locator(`> ${li('root')} > ul > ${li('grand')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page }) => {
  p = project(tree())
  s = await p.serve()
  await page.goto(s.url)
  await expect(page.locator(li('root'))).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutMarker: true }))
  expect(p.cli(['add', 'append-log', '--title', 'Use an append-only log', '--parent', 'root']).code).toBe(0)
  expect(p.cli(['accept', 'append-log', '--actor', 'you']).code).toBe(0)
  const drawn = page.locator(`${li('root')} > ul > ${li('append-log')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { heldoutMarker?: boolean }).heldoutMarker)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  p = project(tree())
  s = await p.serve()
  await page.goto(s.url)
  await page.locator(`${li('child-a')} > a`).click()
  await expect(page).toHaveURL(/#child-a$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'child-a')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Child A')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'child-a')
  await expect(page).toHaveURL(/#child-a$/)
})

test('69.4 a second server on the same project waits, then refuses', async ({ page }) => {
  p = project(tree())
  s = await p.serve()
  await page.goto(s.url)
  await expect(page.locator(li('child-b'))).toBeVisible()
  const firstPid = s.proc.pid!
  const second = spawnServe(p.dir, p.env)
  const t0 = Date.now()
  await new Promise<void>((r) => (second.proc.exitCode !== null ? r() : second.proc.once('exit', () => r())))
  const took = Date.now() - t0
  const err = second.err()
  expect(err).toMatch(new RegExp(`wait\\w* for pid ${firstPid}`))
  expect(second.proc.exitCode).not.toBe(0)
  expect(took).toBeLessThan(9000)
  expect(err).toMatch(new RegExp(`another werk[^\\n]*pid ${firstPid}`))
  await page.goto(s.url)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator('li')).toHaveCount(4)
  await expect(map.locator(`${li('grand')}`)).toBeVisible()
})

test('69.5 make e2e runs the browser specs and leaves one screenshot per test', async () => {
  test.setTimeout(600_000)
  const { mkdtempSync, readdirSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  const ROOT = join(import.meta.dirname, '..', '..')
  const out = mkdtempSync(join(tmpdir(), 'werk-heldout-e2e-'))
  const fixtureLog = join(ROOT, 'e2e', 'fixture-project', '.werk', 'log.jsonl')
  const before = readFileSync(fixtureLog, 'utf8')
  const r = spawnSync('bunx', ['playwright', 'test', '--config', join(ROOT, 'playwright.config.ts'), '--output', out, '--reporter', 'list'], {
    cwd: ROOT,
    env: { ...process.env, CI: 'true' },
    encoding: 'utf8',
  })
  const text = r.stdout + r.stderr
  const n = (w: string) => Number(text.match(new RegExp(`(\\d+) ${w}`))?.[1] ?? 0)
  const summary = text.match(/(\d+) passed/)
  const testsRan = n('passed') + n('failed') + n('flaky')
  const shots: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name))
      else if (e.name === 'evidence.png') shots.push(join(d, e.name))
    }
  }
  if (existsSync(out)) walk(out)
  console.log(`exit ${r.status}; result lines ${testsRan}; ${summary?.[0]}; screenshots ${shots.length}`)
  console.log(text.split('\n').slice(-8).join('\n'))
  expect(testsRan).toBeGreaterThan(0)
  expect(shots.length).toBe(testsRan)
  expect(readFileSync(fixtureLog, 'utf8')).toBe(before)
  expect(r.status).toBe(0)
})
