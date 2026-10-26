/** Held-out test helpers: a temporary project, werk commands, and a real server. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLI, testEnv } from '../test/env.ts'

export { CLI, testEnv }
export type Run = { code: number; stdout: string; stderr: string; out: string }

export class Project {
  readonly dir: string
  env: Record<string, string> = {}
  constructor(options: { werkDir?: boolean } = {}) {
    this.dir = realpathSync(mkdtempSync(join(tmpdir(), 'werk-heldout-')))
    if (options.werkDir !== false) mkdirSync(join(this.dir, '.werk'), { recursive: true })
  }
  werk(...args: string[]): Run {
    const r = spawnSync('bun', [CLI, ...args], { cwd: this.dir, env: testEnv(this.env), encoding: 'utf8' })
    const plain = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, '')
    return { code: r.status ?? 1, stdout: plain(r.stdout), stderr: plain(r.stderr), out: plain(r.stdout + r.stderr) }
  }
  /** A werk command that must succeed (setup only). */
  ok(...args: string[]): Run {
    const r = this.werk(...args)
    if (r.code !== 0) throw new Error(`setup: werk ${args.join(' ')} failed (${r.code}): ${r.out}`)
    return r
  }
  get logPath() {
    return join(this.dir, '.werk', 'log.jsonl')
  }
  log(): string {
    return existsSync(this.logPath) ? readFileSync(this.logPath, 'utf8') : ''
  }
  events(): any[] {
    return this.log().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  }
  show(id?: string): any {
    const r = this.werk('show', ...(id === undefined ? [] : [id]))
    if (r.code !== 0) throw new Error(`show ${id} failed: ${r.out}`)
    return JSON.parse(r.stdout)
  }
  /** Setup: a real (accepted) card. */
  real(id: string, title: string, ...more: string[]): void {
    this.ok('add', id, '--title', title, ...more)
    this.ok('accept', id, '--actor', 'you')
  }
  /** Setup: a real card with every contract fact, decided. */
  decided(id: string, title: string, ...more: string[]): void {
    this.real(id, title, '--who', 'me', ...more)
    this.ok('edit', id, '--no-basis', 'a root decision for the test')
    this.ok('kill', id, 'revisit when the test changes')
    this.ok('decide', id)
  }
  write(path: string, text: string): void {
    mkdirSync(join(this.dir, path, '..'), { recursive: true })
    writeFileSync(join(this.dir, path), text)
  }
  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }
}

export type Served = { port: number; url: string; proc: ChildProcess; output(): string; stop(): Promise<void> }

export async function serve(dir: string, opts: { args?: string[]; cmd?: string[]; env?: Record<string, string> } = {}): Promise<Served> {
  const cmd = opts.cmd ?? ['bun', CLI]
  const proc = spawn(cmd[0]!, [...cmd.slice(1), ...(opts.args ?? ['serve', '--port', '0'])], { cwd: dir, env: testEnv(opts.env), stdio: ['ignore', 'pipe', 'pipe'] })
  let text = ''
  proc.stdout!.on('data', (c) => (text += c.toString()))
  proc.stderr!.on('data', (c) => (text += c.toString()))
  const exited = new Promise<void>((r) => proc.once('exit', () => r()))
  const deadline = Date.now() + 30_000
  let m: RegExpMatchArray | null = null
  while (!(m = text.match(/at http:\/\/localhost:(\d+) /))) {
    if (proc.exitCode !== null) throw new Error(`server exited: ${text}`)
    if (Date.now() > deadline) throw new Error(`server did not start: ${text}`)
    await new Promise((r) => setTimeout(r, 50))
  }
  const port = Number(m[1])
  return {
    port,
    url: `http://localhost:${port}`,
    proc,
    output: () => text,
    stop: async () => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM')
      await exited
    },
  }
}
