/**
 * Temporary projects for command-line and server tests. A project is a directory with an
 * empty `.werk/` and, by default, a git repository with one commit. Every werk command runs
 * with the test environment from env.ts, so the fake agent is first on PATH.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CLI, testEnv } from './env.ts'

export type RunResult = { code: number; stdout: string; stderr: string }

export type TempProject = {
  readonly dir: string
  /** Runs `werk <args>` in the project and waits for it to exit. */
  run(args: readonly string[], env?: Record<string, string>): RunResult
  /** Runs git in the project. */
  git(args: readonly string[]): RunResult
  cleanup(): void
}

export type ProjectOptions = {
  /** Make the directory a git repository with one commit. Default true. */
  git?: boolean
  /** Files to write, relative to the project directory. */
  files?: Record<string, string>
  /** A directory to copy in as the project's starting content. */
  from?: string
}

export function makeProject(options: ProjectOptions = {}): TempProject {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'werk-project-')))
  if (options.from) cpSync(options.from, dir, { recursive: true })
  mkdirSync(join(dir, '.werk'), { recursive: true })
  for (const [path, text] of Object.entries(options.files ?? {})) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const exec = (command: string, args: readonly string[], env?: Record<string, string>): RunResult => {
    const result = spawnSync(command, args, { cwd: dir, env: testEnv(env), encoding: 'utf8' })
    return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
  }
  const git = (args: readonly string[]) => exec('git', args)
  if (options.git ?? true) {
    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['config', 'user.email', 'test@werk.invalid'],
      ['config', 'user.name', 'werk test'],
      ['config', 'commit.gpgsign', 'false'],
      ['add', '-A'],
      ['commit', '-q', '--allow-empty', '-m', 'start'],
    ]) {
      const result = git(args)
      if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
    }
  }
  return {
    dir,
    run: (args, env) => exec(process.execPath, [CLI, ...args], env),
    git,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

export type RunningServer = {
  readonly port: number
  readonly process: ChildProcess
  /** Everything the server printed so far, stdout and stderr. */
  output(): string
  /** Waits until the output matches, or fails after the timeout. */
  waitFor(pattern: RegExp, timeoutMs?: number): Promise<RegExpMatchArray>
  stop(): Promise<void>
}

/**
 * Starts `werk serve --port 0` in a project and waits for its address. With `hot`, the
 * server runs under `bun --hot`, the dev command. `entry` replaces src/cli.ts as the script.
 */
export async function startServe(
  dir: string,
  options: { hot?: boolean; entry?: string; args?: readonly string[]; env?: Record<string, string> } = {},
): Promise<RunningServer> {
  const entry = options.entry ?? CLI
  const args = [...(options.hot ? ['--hot'] : []), entry, ...(options.args ?? ['serve', '--port', '0'])]
  const child = spawn(process.execPath, args, { cwd: dir, env: testEnv(options.env), stdio: ['ignore', 'pipe', 'pipe'] })
  let text = ''
  const listeners = new Set<() => void>()
  const collect = (chunk: Buffer) => {
    text += chunk.toString()
    for (const listener of listeners) listener()
  }
  child.stdout!.on('data', collect)
  child.stderr!.on('data', collect)
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))

  const waitFor = (pattern: RegExp, timeoutMs = 15_000) =>
    new Promise<RegExpMatchArray>((resolve, reject) => {
      const check = () => {
        const match = text.match(pattern)
        if (!match) return
        cleanup()
        resolve(match)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`timed out waiting for ${pattern}; output:\n${text}`))
      }, timeoutMs)
      const onExit = () => {
        cleanup()
        reject(new Error(`server exited before ${pattern}; output:\n${text}`))
      }
      const cleanup = () => {
        clearTimeout(timer)
        listeners.delete(check)
        child.off('exit', onExit)
      }
      listeners.add(check)
      child.once('exit', onExit)
      check()
    })

  const match = await waitFor(/at http:\/\/localhost:(\d+) /)
  return {
    port: Number(match[1]),
    process: child,
    output: () => text,
    waitFor,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await exited
    },
  }
}

/** Opens the live channel and returns its first event, parsed. */
export async function liveHello(port: number): Promise<{ pid: number; bootId: string; startedAt: string; children: { name: string; pid: number }[] }> {
  const controller = new AbortController()
  const res = await fetch(`http://localhost:${port}/api/live`, { signal: controller.signal })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (!text.includes('\n\n')) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    controller.abort()
  }
  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .join('\n')
  return JSON.parse(data)
}

export type LiveEvent = { event: string; data: unknown }

export type LiveChannel = {
  /** Waits for the next event with this name, or fails after the timeout. */
  next(event: string, timeoutMs?: number): Promise<LiveEvent>
  close(): void
}

/** Opens the live channel and reads its events as they arrive. */
export async function openLive(port: number): Promise<LiveChannel> {
  const controller = new AbortController()
  const res = await fetch(`http://localhost:${port}/api/live`, { signal: controller.signal })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const parse = (block: string): LiveEvent => {
    const lines = block.split('\n')
    const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length) ?? 'message'
    const data = lines
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice('data: '.length))
      .join('\n')
    return { event, data: JSON.parse(data) }
  }
  const read = async (): Promise<LiveEvent> => {
    while (!text.includes('\n\n')) {
      const { value, done } = await reader.read()
      if (done) throw new Error('the live channel closed')
      text += decoder.decode(value, { stream: true })
    }
    const end = text.indexOf('\n\n')
    const block = text.slice(0, end)
    text = text.slice(end + 2)
    return parse(block)
  }
  return {
    next: async (event, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const left = deadline - Date.now()
        if (left <= 0) throw new Error(`no ${event} event on the live channel in ${timeoutMs} ms`)
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no ${event} event on the live channel in ${timeoutMs} ms`)), left)
        })
        try {
          const got = await Promise.race([read(), timeout])
          if (got.event === event) return got
        } finally {
          clearTimeout(timer)
        }
      }
    },
    close: () => controller.abort(),
  }
}
