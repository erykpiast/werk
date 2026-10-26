import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHECKOUT } from '../../src/test/app-copy.ts'

// Other binders write under .werk-heldout/ at the same time, so that folder is left out of the comparison.
const changes = () => {
  const r = Bun.spawnSync(['git', 'status', '--porcelain', '--untracked-files=all', '--', '.', ':!.werk-heldout'], { cwd: CHECKOUT, stdout: 'pipe' })
  return r.stdout.toString()
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('101.5 a failed hot-reload test leaves the checkout clean', async () => {
  expect(changes()).toBe('')
  const dir = mkdtempSync(join(tmpdir(), 'heldout-out-'))
  const out = join(dir, 'out.jsonl')
  try {
    const r = Bun.spawnSync([process.execPath, 'test', './.werk-heldout/g2/fixtures/hot-fail.fixture.ts'], {
      cwd: CHECKOUT,
      env: { ...process.env, HELDOUT_OUT: out },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(r.stderr.toString()).toContain('this hot-reload test fails on purpose')
    expect(r.exitCode).toBe(1)
    const used = JSON.parse(readFileSync(out, 'utf8').trim()) as { root: string; pid: number; url: string }
    expect(alive(used.pid)).toBe(false)
    expect(await fetch(used.url).then(() => 'answered', () => 'no answer')).toBe('no answer')
    expect(existsSync(used.root)).toBe(false)
    expect(changes()).toBe('')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 60_000)
