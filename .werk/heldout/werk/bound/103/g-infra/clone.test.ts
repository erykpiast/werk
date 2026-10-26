/** Held-out steps 95.4 and 95.5: the browser test server's guard, and a fresh clone's make test. */
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHECKOUT = join(import.meta.dir, '..', '..')
const REAL_AGENT_DIR = join(process.env.HOME_REAL ?? '/Users/eryk.napierala', '.local', 'bin')

test(
  '95.4 the browser test server refuses to start when the fake agent is not first',
  () => {
    expect(existsSync(join(REAL_AGENT_DIR, 'claude'))).toBe(true)
    const out = mkdtempSync(join(tmpdir(), 'werk-heldout-pw-'))
    try {
      const env = { ...process.env, PATH: `${REAL_AGENT_DIR}:${process.env.PATH}`, CI: 'true', PLAYWRIGHT_BROWSERS_PATH: '/Users/eryk.napierala/Library/Caches/ms-playwright' } as Record<string, string>
      const p = Bun.spawnSync(['bunx', 'playwright', 'test', 'e2e/map.spec.ts', '-g', 'cards of the fixture project', '--output', out, '--reporter', 'list'], {
        cwd: CHECKOUT,
        env,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const text = p.stdout.toString() + p.stderr.toString()
      console.log(text.slice(-2500))
      expect(p.exitCode).not.toBe(0)
      expect(text).toMatch(/fake agent/)
      expect(text).toMatch(/PATH/)
      expect(text).not.toMatch(/\b1 passed\b/)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  },
  180_000,
)

test(
  '95.5 a fresh clone passes its checks with no manual step',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
    try {
      const dir = join(root, 'werk')
      expect(Bun.spawnSync(['git', 'clone', '--quiet', CHECKOUT, dir]).exitCode).toBe(0)
      expect(existsSync(join(dir, 'node_modules'))).toBe(false)
      const elsewhere = join(root, 'elsewhere')
      Bun.spawnSync(['mkdir', elsewhere])
      const p = Bun.spawnSync(['make', '-f', join(dir, 'Makefile'), 'test'], { cwd: elsewhere, env: { ...process.env }, stdout: 'pipe', stderr: 'pipe' })
      const text = p.stdout.toString() + p.stderr.toString()
      if (p.exitCode !== 0) console.log(text.slice(-4000))
      expect(text).toMatch(/bun install --frozen-lockfile/)
      expect(text.indexOf('bun install')).toBeLessThan(text.indexOf('bun test'))
      expect(text).toContain(`cd ${dir}`)
      expect(existsSync(join(dir, 'node_modules'))).toBe(true)
      expect(p.exitCode).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  20 * 60_000,
)
