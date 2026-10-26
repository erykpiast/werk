import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLI, testEnv } from '../test/env.ts'

export function tempProject(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'heldout-proj-')))
}

export function werk(dir: string, ...args: string[]): { code: number | null; out: string; err: string } {
  const r = spawnSync('bun', [CLI, ...args], { cwd: dir, env: testEnv(), encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

export function logText(dir: string): string {
  return readFileSync(join(dir, '.werk', 'log.jsonl'), 'utf8')
}

export type Served = { url: string; output: () => string; proc: ChildProcess; stop: () => Promise<void> }

export async function serve(dir: string, args: string[] = ['serve', '--port', '0']): Promise<Served> {
  const proc = spawn('bun', [CLI, ...args], { cwd: dir, env: testEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
  let text = ''
  proc.stdout!.on('data', (b) => (text += b))
  proc.stderr!.on('data', (b) => (text += b))
  const exited = new Promise<void>((r) => proc.once('exit', () => r()))
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no address printed: ' + text)), 20_000)
    const check = () => {
      const m = text.match(/(http:\/\/localhost:\d+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1]!)
      }
    }
    proc.stdout!.on('data', check)
    proc.stderr!.on('data', check)
    proc.once('exit', () => reject(new Error('server exited: ' + text)))
  })
  return {
    url,
    output: () => text,
    proc,
    stop: async () => {
      if (proc.exitCode === null) proc.kill('SIGTERM')
      await exited
    },
  }
}

export function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true })
}
