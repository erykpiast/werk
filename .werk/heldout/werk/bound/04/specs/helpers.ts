import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A byte-identical copy of v0/, with its dependencies installed. */
export const WERK = join(import.meta.dirname, '..', 'v0')
export const CLI = join(WERK, 'src', 'cli.ts')
export const FAKE_AGENT_DIR = join(WERK, 'test', 'fake-agent')

export function env(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('WERK_') && k !== 'FORCE_COLOR') out[k] = v
  out.PATH = [FAKE_AGENT_DIR, ...(out.PATH ?? '').split(':').filter((p) => p && p !== FAKE_AGENT_DIR)].join(':')
  return { ...out, ...extra }
}

export type Run = { code: number; stdout: string; stderr: string; out: string }

export function makeProject(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'werk-heldout-')))
  mkdirSync(join(dir, '.werk'), { recursive: true })
  for (const args of [['init', '-q', '-b', 'main'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'start']]) {
    spawnSync('git', args, { cwd: dir })
  }
  return dir
}

export function werk(dir: string, ...args: string[]): Run {
  const r = spawnSync('bun', [CLI, ...args], { cwd: dir, env: env(), encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr, out: r.stdout + r.stderr }
}

/** A setup step: must succeed. */
export function must(dir: string, ...args: string[]): Run {
  const r = werk(dir, ...args)
  if (r.code !== 0) throw new Error(`setup: werk ${args.join(' ')} failed: ${r.out}`)
  return r
}

export const logPath = (dir: string) => join(dir, '.werk', 'log.jsonl')
export const logText = (dir: string) => (existsSync(logPath(dir)) ? readFileSync(logPath(dir), 'utf8') : '')
export const logEvents = (dir: string) => logText(dir).split('\n').filter(Boolean).map((l) => JSON.parse(l))

export function show(dir: string, id?: string): any {
  const r = werk(dir, 'show', ...(id ? [id] : []))
  if (r.code !== 0) throw new Error(`show failed: ${r.out}`)
  return JSON.parse(r.stdout)
}

export type Server = { port: number; url: string; proc: ChildProcess; output(): string; waitFor(re: RegExp, ms?: number): Promise<RegExpMatchArray>; stop(): Promise<void> }

export async function serve(dir: string, opts: { hot?: boolean } = {}): Promise<Server> {
  const proc = spawn('bun', [...(opts.hot ? ['--hot'] : []), CLI, 'serve', '--port', '0'], { cwd: dir, env: env(), stdio: ['ignore', 'pipe', 'pipe'] })
  let text = ''
  proc.stdout!.on('data', (c) => (text += c.toString()))
  proc.stderr!.on('data', (c) => (text += c.toString()))
  const exited = new Promise<void>((r) => proc.once('exit', () => r()))
  const waitFor = async (re: RegExp, ms = 20_000) => {
    const end = Date.now() + ms
    for (;;) {
      const m = text.match(re)
      if (m) return m
      if (proc.exitCode !== null) throw new Error(`server exited; output:\n${text}`)
      if (Date.now() > end) throw new Error(`timed out waiting for ${re}; output:\n${text}`)
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  const m = await waitFor(/at (http:\/\/localhost:(\d+))/)
  return {
    port: Number(m[2]),
    url: m[1]!,
    proc,
    output: () => text,
    waitFor,
    stop: async () => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM')
      await exited
    },
  }
}

export function cleanup(dir: string | undefined) {
  if (dir) rmSync(dir, { recursive: true, force: true })
}

/** Adds a card and accepts it (a setup step for a "real" card in a Given). */
export function realCard(dir: string, id: string, title: string, ...flags: string[]) {
  must(dir, 'add', id, '--title', title, ...flags)
  must(dir, 'accept', id, '--actor', 'you')
}

/** Setup: makes a real card decided with the minimum facts (who me, no basis, a kill criterion). */
export function decidedCard(dir: string, id: string, title: string, ...flags: string[]) {
  realCard(dir, id, title, '--who', 'me', ...flags)
  must(dir, 'edit', id, '--no-basis', 'a root decision for the test')
  must(dir, 'kill', id, 'revisit when the test changes')
  must(dir, 'decide', id)
}
