import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'

const MAIN = join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts')
const card = (id: string) => `li[data-card-id="${id}"]`

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  const before = await page.locator('li[data-card-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  const firstPid = (JSON.parse(readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')) as { pid: number }).pid
  const env = { PATH: process.env.PATH ?? '', HOME: werk.dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  const t0 = Date.now()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  let out = ''
  let sawWaitAt = -1
  second.stderr.on('data', (c: Buffer) => {
    err += c.toString()
    if (sawWaitAt < 0 && err.includes(`waiting for pid ${firstPid}`)) sawWaitAt = Date.now() - t0
  })
  second.stdout.on('data', (c: Buffer) => (out += c.toString()))
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => { second.kill('SIGKILL'); resolve(null) }, 12_000)
    second.once('exit', (c) => { clearTimeout(timer); resolve(c) })
  })
  const took = Date.now() - t0
  expect(err).toContain(`waiting for pid ${firstPid}`)
  expect(sawWaitAt).toBeGreaterThanOrEqual(0)
  expect(code).not.toBe(0)
  expect(code).not.toBeNull()
  expect(took).toBeLessThan(8_000)
  expect(err.split(`waiting for pid ${firstPid}`)[1]).toContain(String(firstPid))
  await page.goto(werk.url)
  await expect(page.locator(card('werk'))).toBeVisible()
  const after = await page.locator('li[data-card-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  expect(after).toEqual(before)
  test.info().annotations.push({ type: 'observed', description: `exit ${code} after ${took}ms; stderr: ${err.trim()}` })
})
