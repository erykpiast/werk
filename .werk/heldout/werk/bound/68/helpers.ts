import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const REPO = join(import.meta.dir, '..')
export const MAIN = join(REPO, 'src', 'cli', 'main.ts')
export const BUN = process.execPath

export type R = { code: number; stdout: string; stderr: string }

export function sh(cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env): R {
  const p = Bun.spawnSync(cmd, { cwd, env: env as Record<string, string>, stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString() }
}

export type Map_ = {
  dir: string
  werk: (args: string[]) => R
  logLines: () => string[]
  logText: () => string
  cleanup: () => void
}

export function makeMap(): Map_ {
  const dir = mkdtempSync(join(tmpdir(), 'werk-heldout-map-'))
  const env = { ...process.env, WERK_LOG: '' }
  delete (env as Record<string, string | undefined>).WERK_LOG
  const logPath = join(dir, '.werk', 'log.jsonl')
  const logText = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '')
  return {
    dir,
    werk: (args) => sh([BUN, MAIN, ...args], dir, env),
    logText,
    logLines: () => logText().split('\n').filter(Boolean),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/** Splits inbox output into groups: header line, then the note lines. */
export function inboxGroups(out: string): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const block of out.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (lines.length === 0) continue
    const m = lines[0]!.match(/^#(\S+)/)
    if (m) groups.set(m[1]!, lines.slice(1))
  }
  return groups
}

export function cloneRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  const dir = join(root, 'werk')
  const r = sh(['git', 'clone', '--quiet', REPO, dir], root)
  if (r.code !== 0) throw new Error(`clone failed: ${r.stderr}`)
  const head = sh(['git', 'rev-parse', 'HEAD'], REPO).stdout.trim()
  sh(['git', 'checkout', '--quiet', head], dir)
  return dir
}
