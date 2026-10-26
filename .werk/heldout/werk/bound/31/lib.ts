import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
export { makeProject, type Project, type RunResult } from '../src/test/cli-harness.ts'

export const REPO = join(import.meta.dir, '..')
export const HEAD = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: REPO }).stdout.toString().trim()

/** The parent env without what bun test adds. */
export function cleanEnv(): Record<string, string> {
  const e: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'NODE_ENV' && !k.startsWith('BUN_')) e[k] = v
  return e
}

export interface Out { code: number; stdout: string; stderr: string; all: string }

export async function sh(cmd: string[], cwd: string, env: Record<string, string> = {}, timeoutMs = 600_000): Promise<Out> {
  const child = Bun.spawn(cmd, { cwd, env: { ...cleanEnv(), CI: 'true', ...env }, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const timer = setTimeout(() => child.kill(), timeoutMs)
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  clearTimeout(timer)
  return { code, stdout, stderr, all: stdout + stderr }
}

let base: string | undefined
/** A fresh clone of this checkout at HEAD with the locked dependencies installed. */
export async function cloneRepo(): Promise<{ dir: string; cleanup(): void }> {
  if (!base) {
    const root = mkdtempSync(join(tmpdir(), 'werk-heldout-base-'))
    base = join(root, 'werk')
    await sh(['git', 'clone', '-q', REPO, base], root)
    await sh(['git', 'checkout', '-q', HEAD], base)
    const r = await sh(['bun', 'install', '--frozen-lockfile'], base)
    if (r.code !== 0) throw new Error(r.all)
  }
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  const dir = join(root, 'werk')
  await sh(['cp', '-R', base, dir], root)
  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** A snapshot of every file under dir except node_modules, as path -> content. */
export function snapshot(dir: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const f of new Bun.Glob('**/*').scanSync({ cwd: dir, dot: true })) {
    if (f.startsWith('node_modules/') || f.startsWith('.git/') || f.startsWith('.werk-heldout/')) continue
    m.set(f, readFileSync(join(dir, f), 'utf8'))
  }
  return m
}

export interface Server { url: string; output(): string; pid: number; stop(): void }

/** Runs `werk <verb>` in a project and waits for it to print an http address. */
export async function startServer(dir: string, env: Record<string, string>, argv: string[] = ['serve'], waitMs = 15_000): Promise<Server> {
  const child = Bun.spawn([process.execPath, join(REPO, 'src', 'cli.ts'), ...argv], { cwd: dir, env, stdout: 'pipe', stderr: 'pipe' })
  let text = ''
  const pump = async (s: ReadableStream<Uint8Array>) => { for await (const c of s) text += new TextDecoder().decode(c) }
  void pump(child.stdout); void pump(child.stderr)
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    const m = text.match(/https?:\/\/[^\s"']+/)
    if (m) return { url: m[0], output: () => text, pid: child.pid, stop: () => child.kill() }
    if (child.exitCode !== null) break
    await Bun.sleep(100)
  }
  child.kill()
  throw new Error(`werk ${argv.join(' ')} printed no address. exit=${child.exitCode} output=${JSON.stringify(text)}`)
}

export { existsSync }
