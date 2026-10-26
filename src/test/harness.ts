/** Small helpers shared by the behaviour tests. No test lives here. */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function scratchDir(prefix = 'werk-b-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** Poll until `check` returns something truthy, or fail with `what` after `ms`. */
export async function waitFor<T>(check: () => T, what: string, ms = 5000): Promise<NonNullable<T>> {
  const until = Date.now() + ms
  for (;;) {
    const v = check()
    if (v) return v as NonNullable<T>
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type FakeEntry = { argv?: string[]; pid?: number; stdin?: any }

/** What the fake claude recorded: one entry per launch and per stdin line. */
export function fakeLog(path: string): FakeEntry[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as FakeEntry)
}

export const launches = (path: string) => fakeLog(path).filter((e) => e.argv).map((e) => e.argv!)
export const stdinOf = (path: string) => fakeLog(path).filter((e) => e.stdin).map((e) => e.stdin)

/** The value after a flag in an argv list, or undefined. */
export const flag = (argv: string[], name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)

/** Set the fake claude's steering variables for one test; returns the undo. */
export function fakeEnv(vars: Record<string, string>): () => void {
  const before: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k]
    process.env[k] = v
  }
  return () => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

/** Process ids of every fake claude launched, in launch order. */
export const pids = (path: string) => fakeLog(path).filter((e) => e.pid).map((e) => e.pid!)

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export type Served = { url: string; dir: string; werk: string; log: string; proc: import('bun').Subprocess; out: () => string; stop: () => Promise<void> }

const CLI = join(import.meta.dir, '..', 'cli.ts')

/**
 * `werk serve` as its own process, on a scratch .werk, with the fake claude on PATH. The
 * returned promise settles once the server prints its URL. Ports 4942-4949 belong to the
 * behaviour tests; 4941 is the e2e server's.
 */
export async function serveScratch(port: number, opts: { dir?: string; env?: Record<string, string>; wait?: boolean } = {}): Promise<Served> {
  const dir = opts.dir ?? scratchDir('werk-serve-')
  const werk = join(dir, '.werk')
  const log = join(dir, 'fake.jsonl')
  let out = ''
  // #werk-projects-add: werk takes only a folder with a git repository as a project. Each
  // server keeps its own project list, so parallel servers never see each other's projects.
  if (!existsSync(join(dir, '.git'))) Bun.spawnSync(['git', 'init', '-q'], { cwd: dir })
  const proc = Bun.spawn(['bun', CLI, 'serve', '--port', String(port)], {
    cwd: dir,
    env: { ...process.env, WERK_LOG: join(werk, 'log.jsonl'), WERK_CONFIG_DIR: join(dir, '.werk-config'), FAKE_CLAUDE_LOG: log, ...opts.env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) out += new TextDecoder().decode(chunk)
  }
  void drain(proc.stdout as ReadableStream<Uint8Array>)
  void drain(proc.stderr as ReadableStream<Uint8Array>)
  const served: Served = {
    url: `http://localhost:${port}`,
    dir,
    werk,
    log,
    proc,
    out: () => out,
    stop: async () => {
      proc.kill('SIGTERM')
      await proc.exited
    },
  }
  if (opts.wait !== false) await waitFor(() => out.includes(`werk map on http://localhost:${port}`) || proc.exitCode !== null, 'the server to listen', 10000)
  return served
}

/** Run `werk <args>` to completion against one scratch log. */
export function cli(args: string[], opts: { cwd: string; log: string; env?: Record<string, string> }) {
  const r = Bun.spawnSync(['bun', CLI, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, WERK_LOG: opts.log, ...opts.env },
  })
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() }
}
