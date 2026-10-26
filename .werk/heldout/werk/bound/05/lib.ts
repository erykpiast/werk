import { afterAll, afterEach } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import { CLI, testEnv } from '../v0/test/env.ts'
import { makeProject, startServe, type RunningServer, type TempProject } from '../v0/test/harness.ts'

export { CLI, testEnv, makeProject, startServe }
export type { RunningServer, TempProject, Page }

/** Soft checks: every check runs, and the test fails at the end with the list of misses. */
export class Checks {
  misses: string[] = []
  seen: string[] = []
  ok(cond: unknown, what: string): boolean {
    if (cond) this.seen.push(`ok: ${what}`)
    else this.misses.push(`MISS: ${what}`)
    return !!cond
  }
  note(text: string) {
    this.seen.push(`note: ${text}`)
  }
  report(): string {
    return [...this.seen, ...this.misses].join('\n')
  }
}

const cleanups: (() => Promise<void> | void)[] = []
export function onCleanup(fn: () => Promise<void> | void) {
  cleanups.push(fn)
}
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

let browser: Browser | undefined
afterAll(async () => {
  await browser?.close()
})

export function project(): TempProject {
  const p = makeProject()
  onCleanup(() => p.cleanup())
  return p
}

export async function serve(dir: string): Promise<RunningServer> {
  const s = await startServe(dir)
  onCleanup(() => s.stop())
  return s
}

export type Opened = { page: Page; errors: string[] }

export async function open(port: number, hash = ''): Promise<Opened> {
  browser ??= await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  onCleanup(() => context.close())
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(`http://localhost:${port}/${hash}`)
  return { page, errors }
}

/** Waits up to `ms` for a condition the page shows, the time a user looks at the page. */
export async function shows(page: Page, fn: () => Promise<boolean>, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms
  for (;;) {
    try {
      if (await fn()) return true
    } catch {}
    if (Date.now() > end) return false
    await page.waitForTimeout(100)
  }
}

export function logText(dir: string): string {
  const path = join(dir, '.werk', 'log.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

export function logEvents(dir: string): any[] {
  return logText(dir).split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

export function mustRun(p: TempProject, args: string[]) {
  const r = p.run(args)
  if (r.code !== 0) throw new Error(`setup: werk ${args.join(' ')} failed: ${r.stderr}`)
  return r
}

export function showCard(p: TempProject, id: string): any {
  const r = p.run(['show', id])
  return r.code === 0 ? JSON.parse(r.stdout) : undefined
}

/** The command lines a refusal prints: each line that starts with `werk `. */
export function fixLines(stderr: string): string[] {
  return stderr.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('werk ') && !l.startsWith('werk: '))
}

/** Runs a printed `werk ...` line in the project, through sh, with `werk` bound to the CLI. */
export function runPrinted(dir: string, line: string) {
  const r = spawnSync('sh', ['-c', `werk() { "$HB_BUN" "$HB_CLI" "$@"; }; ${line}`], {
    cwd: dir,
    env: testEnv({ HB_BUN: process.execPath, HB_CLI: CLI }),
    encoding: 'utf8',
  })
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}

/** Sets up a card that passes the decide check with no basis needed: who, no-basis, kill. */
export function decidedRoot(p: TempProject, id: string, title: string, extra: string[] = []) {
  mustRun(p, ['add', id, '--title', title, '--who', 'me', ...extra])
  mustRun(p, ['edit', id, '--no-basis', 'a root of the map'])
  mustRun(p, ['kill', id, 'revisit when the product changes'])
  mustRun(p, ['decide', id])
}
