/** Helpers for the held-out repository tests: a fresh clone of this checkout in a temp dir. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SOURCE = join(import.meta.dir, '..')

export type Run = { code: number; out: string }

export function clone(): { dir: string; run: (cmd: string[], env?: Record<string, string>) => Run; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  const dir = join(root, 'werk')
  const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: SOURCE }).stdout.toString().trim()
  const c = Bun.spawnSync(['git', 'clone', '--quiet', '--no-local', SOURCE, dir], { stdout: 'pipe', stderr: 'pipe' })
  if (c.exitCode !== 0) throw new Error(`clone failed: ${c.stderr}`)
  // The checkout is a detached worktree at main; make the clone's main point at the same commit.
  Bun.spawnSync(['git', 'checkout', '--quiet', '-B', 'main', head], { cwd: dir })
  const run = (cmd: string[], env: Record<string, string> = {}) => {
    const p = Bun.spawnSync(cmd, { cwd: dir, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
    return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
  }
  return { dir, run, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** The PATH of this shell with every directory that holds a `claude` program removed. */
export function pathWithoutClaude(): string {
  return (process.env.PATH ?? '')
    .split(':')
    .filter((d) => d !== '' && !existsSync(join(d, 'claude')))
    .join(':')
}
