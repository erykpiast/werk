/** Step 101.5: a failed hot-reload test leaves the checkout clean. */
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHECKOUT = join(import.meta.dir, '..', '..')
/** The changed files of the checkout, outside the held-out folder that holds this test. */
const changed = () => {
  const r = Bun.spawnSync(['git', 'status', '--porcelain', '--', '.', ':(exclude).werk-heldout'], { cwd: CHECKOUT })
  return r.stdout.toString().trim()
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test(
  '101.5 a failed hot-reload test leaves the checkout clean',
  async () => {
    expect(changed()).toBe('')
    const dir = mkdtempSync(join(tmpdir(), 'heldout-101-5-'))
    const out = join(dir, 'out.json')
    try {
      const run = Bun.spawnSync([process.execPath, 'test', './.werk-heldout/g100-101/inner_hot_fail_test.ts'], {
        cwd: CHECKOUT,
        env: { ...process.env, HELDOUT_OUT: out, CI: 'true' },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const text = run.stdout.toString() + run.stderr.toString()
      expect(run.exitCode, text).not.toBe(0)
      expect(text).toContain('1 fail')
      expect(existsSync(out), text).toBe(true)
      const started = JSON.parse(readFileSync(out, 'utf8')) as { pid: number; url: string; appRoot: string; project: string }
      // The app from the copy is stopped.
      expect(alive(started.pid)).toBe(false)
      expect(await fetch(started.url).then(() => 'answered', () => 'no answer')).toBe('no answer')
      // The copy is removed.
      expect(existsSync(started.appRoot)).toBe(false)
      expect(existsSync(started.project)).toBe(false)
      // The checkout still has no changed file.
      expect(changed()).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  90_000,
)
