// 01.1 — A user starts werk in a project and sees the empty map shell.
import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyRepo } from './infra-copy.ts'

const PORT = 5201

test('01.1 werk serve in an empty project shows the empty map shell that React renders', async ({ page }) => {
  test.setTimeout(120_000)
  const { root, v0 } = copyRepo()
  // A project directory with no cards in it: an empty directory.
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'werk-ho-empty-')))
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('WERK_')) delete env[k]
  const proc = spawn('bun', [join(v0, 'src', 'cli.ts'), 'serve', '--port', String(PORT)], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  proc.stdout!.on('data', (d) => (out += d.toString()))
  proc.stderr!.on('data', (d) => (out += d.toString()))
  try {
    const deadline = Date.now() + 30_000
    let address: string | undefined
    while (!address) {
      address = out.match(/https?:\/\/(localhost|127\.0\.0\.1):\d+/)?.[0]
      if (address) break
      if (proc.exitCode !== null || Date.now() > deadline) throw new Error(`server printed no address:\n${out}`)
      await new Promise((r) => setTimeout(r, 50))
    }
    console.log('server printed:', out.trim())

    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`) })
    page.on('response', (r) => { if (r.status() >= 400) pageErrors.push(`HTTP ${r.status()} ${r.url()}`) })

    await page.goto(address)

    // React renders the page: the root container carries React's internal container key,
    // and the content inside it comes from React (no static markup in the served HTML).
    const html = await (await page.request.get(address)).text()
    await expect(page.locator('#root > *').first()).toBeVisible()
    const reactRoot = await page.evaluate(() => {
      const el = document.getElementById('root')
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactContainer$'))
    })
    expect(reactRoot, 'the #root element is a React root').toBe(true)
    expect(html).not.toContain('The map has no cards yet')

    // An empty map shell with no cards on it.
    await expect(page.getByText('The map has no cards yet.')).toBeVisible()
    await expect(page.locator('[data-card-id], .card, li a[href^="#"]')).toHaveCount(0)
    await page.screenshot({ path: join(import.meta.dirname, 'test-results', '01.1-empty-shell.png'), fullPage: true })
    const bodyText = await page.locator('body').innerText()
    console.log('page text:', JSON.stringify(bodyText))

    // No error on the page or in the server output.
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(pageErrors).toEqual([])
    expect(out).not.toMatch(/error|exception|warn/i)
  } finally {
    proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    rmSync(project, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})
