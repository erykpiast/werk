/** Shared helpers for the held-out tests. The product under test is the copy of v0 in ../product. */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
export { makeProject, startServe, liveHello, openLive, type TempProject, type RunningServer } from '../product/test/harness.ts'
export { testEnv, FAKE_AGENT_DIR, CLI } from '../product/test/env.ts'
import { chromium, type Browser } from '../product/node_modules/playwright/index.mjs'

export const PRODUCT = join(import.meta.dir, '..', 'product')

export function logText(dir: string): string {
  const p = join(dir, '.werk', 'log.jsonl')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}
export function logEvents(dir: string): any[] {
  return logText(dir).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

let browser: Browser | undefined
export async function getBrowser(): Promise<Browser> {
  browser ??= await chromium.launch()
  return browser
}
export async function closeBrowser(): Promise<void> {
  await browser?.close()
  browser = undefined
}

/** Runs werk and throws on a non-zero exit. */
export function ok(project: { run(a: readonly string[]): { code: number; stdout: string; stderr: string } }, ...args: string[]) {
  const r = project.run(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r
}
