/** Helpers for the slow held-out steps: a fresh clone outside the repo, and a person's shell environment. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, statSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'

export const REPO = join(import.meta.dir, '..', '..')
export const HOURS = 60 * 60_000

export type Out = { code: number | null; out: string }

const head = () => Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: REPO, stdout: 'pipe' }).stdout.toString().trim()

/**
 * The environment of the person's shell: the test preload put the fake agent first on PATH and
 * a fresh HOME, so take those back out.
 */
export function personEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('WERK_')) env[k] = v
  env.PATH = (process.env.PATH ?? '')
    .split(':')
    .filter((d) => d !== '' && !d.includes('werk-test-run-'))
    .join(':')
  env.HOME = userInfo().homedir
  delete env.CI
  return { ...env, ...extra }
}

/** A PATH with no `claude` on it: folders that hold one are replaced by a folder of links to everything else in them. */
export function pathWithoutClaude(path: string, shimRoot: string): string {
  const out: string[] = []
  for (const [i, dir] of path.split(':').filter(Boolean).entries()) {
    if (!existsSync(join(dir, 'claude'))) {
      out.push(dir)
      continue
    }
    const shim = join(shimRoot, `shim-${i}`)
    mkdirSync(shim, { recursive: true })
    for (const f of readdirSync(dir)) if (f !== 'claude' && !existsSync(join(shim, f))) symlinkSync(join(dir, f), join(shim, f))
    out.push(shim)
  }
  return out.join(':')
}

/** A fresh clone of the repo at its HEAD, with `main` checked out at that commit. */
export function freshClone(): { dir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-harness-'))
  const dir = join(root, 'c')
  const env = personEnv()
  const sha = head()
  for (const cmd of [
    ['git', 'clone', '--quiet', REPO, dir],
    ['git', '-C', dir, 'checkout', '--quiet', '-B', 'main', sha],
  ]) {
    const r = Bun.spawnSync(cmd, { env, stdout: 'pipe', stderr: 'pipe' })
    if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')}: ${r.stderr}`)
  }
  return { dir, root }
}

/** Runs a command and waits for it, with its output joined. */
export async function sh(cmd: string[], cwd: string, env: Record<string, string>, timeoutMs = HOURS): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs)
  const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  clearTimeout(timer)
  return { code, out: o + e }
}

export const git = (dir: string, ...args: string[]) =>
  Bun.spawnSync(['git', ...args], { cwd: dir, env: personEnv(), stdout: 'pipe', stderr: 'pipe' }).stdout.toString().trim()

export const status = (dir: string) => git(dir, 'status', '--porcelain', '--ignored')

export const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory()
