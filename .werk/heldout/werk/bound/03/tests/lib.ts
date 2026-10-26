/**
 * Shared helpers for the held-out tests. They drive the product copy in ../werk, which is
 * a byte copy of v0/ from this checkout (git ls-files) with its packages installed.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from '../werk/node_modules/playwright/index.mjs'
import { CLI, testEnv } from '../werk/test/env.ts'
import { makeProject, startServe, type RunningServer, type TempProject } from '../werk/test/harness.ts'

export { CLI, testEnv, makeProject, startServe, type RunningServer, type TempProject }
export const WERK = join(import.meta.dir, '..', 'werk')

export const logOf = (p: TempProject) => {
  try {
    return readFileSync(join(p.dir, '.werk', 'log.jsonl'), 'utf8')
  } catch {
    return ''
  }
}
export const events = (p: TempProject) => logOf(p).split('\n').filter(Boolean).map((l) => JSON.parse(l))

/** Runs werk and throws when it fails: for Given steps only. */
export function must(p: TempProject, args: string[]) {
  const r = p.run(args)
  if (r.code !== 0) throw new Error(`given: werk ${args.join(' ')} failed: ${r.stderr}${r.stdout}`)
  return r
}

export function show(p: TempProject, id?: string) {
  const r = p.run(id === undefined ? ['show'] : ['show', id])
  return { ...r, json: r.code === 0 ? JSON.parse(r.stdout) : undefined }
}

/** Runs a printed `werk ...` command line through sh, with werk as the product CLI. */
export function runPrinted(p: TempProject, line: string) {
  const cmd = line.trim().replace(/^werk /, `"${process.execPath}" "${CLI}" `)
  const r = spawnSync('sh', ['-c', cmd], { cwd: p.dir, env: testEnv(), encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}

/** A card that can be decided: who me, a recorded lack of basis, one kill criterion. */
export function decidable(p: TempProject, id: string, title: string, extra: string[] = []) {
  must(p, ['add', id, '--title', title, '--who', 'me', ...extra])
  must(p, ['edit', id, '--no-basis', 'a root fact of this test map'])
  must(p, ['kill', id, 'the test map changes'])
}

let browser: Browser | undefined
export async function openPage(url: string): Promise<{ page: Page; errors: string[] }> {
  browser ??= await chromium.launch()
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(url)
  return { page, errors }
}
export async function closeBrowser() {
  await browser?.close()
  browser = undefined
}
