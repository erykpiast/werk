import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { cpSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The installed copy of v0 (identical to the repo's v0/, plus node_modules). */
export const V0 = join(import.meta.dir, '..', 'v0')

/** A throwaway copy of the werk package, for steps that edit files. */
export function copyWerk(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'heldout-werk-')))
  for (const part of ['src', 'test', 'tools', 'e2e', 'package.json', 'tsconfig.json', 'bunfig.toml', 'playwright.config.ts', 'bun.lock'])
    cpSync(join(V0, part), join(dir, part), { recursive: true })
  symlinkSync(join(V0, 'node_modules'), join(dir, 'node_modules'))
  return dir
}

export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('WERK_')) env[k] = v
  return { ...env, ...extra }
}

export function run(cmd: string, args: string[], cwd: string, env = cleanEnv()) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

export type Proc = { child: ChildProcess; output(): string; waitFor(re: RegExp, ms?: number): Promise<RegExpMatchArray>; stop(): Promise<void> }

export function start(cmd: string, args: string[], cwd: string, env = cleanEnv()): Proc {
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let text = ''
  child.stdout!.on('data', (c) => (text += c))
  child.stderr!.on('data', (c) => (text += c))
  const exited = new Promise<void>((r) => child.once('exit', () => r()))
  return {
    child,
    output: () => text,
    waitFor: async (re, ms = 20_000) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        const m = text.match(re)
        if (m) return m
        if (child.exitCode !== null) break
        await Bun.sleep(50)
      }
      throw new Error(`no ${re} in output:\n${text}`)
    },
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await exited
    },
  }
}

export const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
