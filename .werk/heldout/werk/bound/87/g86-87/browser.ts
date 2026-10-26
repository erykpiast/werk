/** Starts the real werk server on a test project and opens a browser on it. */
import { chromium, type Browser, type Page } from '@playwright/test'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'

const MAIN = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')

export async function openBrowser(p: Project): Promise<{ page: Page; url: string; close: () => Promise<void> }> {
  const server = Bun.spawn([process.execPath, MAIN, 'serve', '--port', '0'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  const reader = server.stdout.getReader()
  let out = ''
  let url: string | undefined
  while (!url) {
    const { value, done } = await reader.read()
    if (done) throw new Error(`werk serve exited: ${out} ${await new Response(server.stderr).text()}`)
    out += new TextDecoder().decode(value)
    url = /http:\/\/\S+\//.exec(out)?.[0]
  }
  const browser: Browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(url)
  return {
    page,
    url,
    close: async () => {
      await browser.close()
      server.kill()
      await server.exited
    },
  }
}
