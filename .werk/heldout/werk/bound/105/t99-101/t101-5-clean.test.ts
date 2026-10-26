/**
 * Held-out step 101.5: a failed hot-reload test leaves the checkout clean. The outer test writes
 * an inner hot-reload test outside the checkout, runs it with bun test from the checkout, and
 * checks what the failure left behind.
 */
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHECKOUT = join(import.meta.dir, '..', '..')
const HARNESS = join(CHECKOUT, 'src', 'test', 'harness.ts')

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const gitStatus = () => {
  const r = Bun.spawnSync(['git', 'status', '--porcelain', '--untracked-files=all', '--', '.', ':!.werk-heldout'], { cwd: CHECKOUT })
  return r.stdout.toString()
}

test(
  '101.5 A failed hot-reload test leaves the checkout clean',
  async () => {
    // Given the checkout has no changed file
    expect(gitStatus()).toBe('')
    const work = mkdtempSync(join(tmpdir(), 'heldout-101-5-'))
    const record = join(work, 'record.json')
    const inner = join(work, 'inner.test.ts')
    writeFileSync(
      inner,
      `import { test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeAppCopy, makeProject, serveProject } from ${JSON.stringify(HARNESS)}

test('a hot-reload test that edits a server module and fails', async () => {
  const p = makeProject()
  const app = makeAppCopy()
  const server = serveProject(p, ['--port', '0'], { app, hot: true })
  await server.url
  const module = join(app.root, 'src', 'server', 'server.ts')
  writeFileSync(module, readFileSync(module, 'utf8') + '\\n// edited by the held-out test\\n')
  writeFileSync(${JSON.stringify(record)}, JSON.stringify({ pid: server.proc.pid, app: app.root, project: p.dir }))
  throw new Error('the hot-reload test fails on purpose')
}, 60_000)
`,
    )
    try {
      const run = Bun.spawnSync([process.execPath, 'test', inner], { cwd: CHECKOUT, stdout: 'pipe', stderr: 'pipe' })
      const out = run.stdout.toString() + run.stderr.toString()
      // The inner test ran and failed after its edit.
      expect(run.exitCode, out).not.toBe(0)
      expect(out).toContain('the hot-reload test fails on purpose')
      expect(existsSync(record), out).toBe(true)
      const { pid, app, project } = JSON.parse(readFileSync(record, 'utf8')) as { pid: number; app: string; project: string }
      // Then the app from the copy is stopped
      expect(alive(pid)).toBe(false)
      // And the copy is removed
      expect(existsSync(app)).toBe(false)
      expect(existsSync(project)).toBe(false)
      // And the checkout still has no changed file
      expect(gitStatus()).toBe('')
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  },
  120_000,
)
