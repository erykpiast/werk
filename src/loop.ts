/**
 * The build loop prototype. See #lp-stateless.
 *
 * One new `claude -p` per pass. It gets the brief, the decided cards, the checks, and the
 * last failure, and nothing else. The loop commits after every pass, so the repository —
 * `git log`, `git diff` — is the only memory between passes. There is no long-session mode:
 * it is the fallback of #lp-stateless's kill criterion (#lp-stateless:long).
 *
 * The loop runs the checks itself after the agent exits. That run is the verdict, even if
 * the agent ran the checks too. No grader step: checks only.
 *
 * The worktree is based on a snapshot of the working tree, not on HEAD: tracked edits and
 * untracked files that .gitignore allows are included. The branch `werk-loop/<id>` is kept
 * after the run, so `git diff <base> werk-loop/<id>` shows what the agents did.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGit, runHeadless } from './prototype.ts'
import { freshPrompt, tail, type CheckResult } from './loop-prompt.ts'
import type { GraphNode } from './types.ts'

export {
  decidedClosure,
  FAILURE_CHARS,
  freshPrompt,
  NO_QUESTIONS,
  renderCards,
  tail,
  type CheckResult,
} from './loop-prompt.ts'

export type PassRecord = {
  run: string
  pass: number
  at: string
  ms: number
  costUsd?: number
  turns?: number
  agentError?: string
  commit?: string
  checks: Array<Omit<CheckResult, 'tail'>>
  green: boolean
}

export type LoopResult = {
  run: string
  base: string
  branch: string
  passes: number
  green: boolean
  costUsd: number
  ms: number
  log: string
  error?: string
}

export const CHECK_TIMEOUT_MS = 5 * 60 * 1000
/** Stage everything. node_modules is symlinked into the worktree, and .gitignore's
 *  `node_modules/` does not match a symlink, so it is unstaged again: never committed. */
export async function addAll(cwd: string, env?: Record<string, string>): Promise<{ code: number; stderr: string }> {
  const add = await runGit(cwd, ['add', '-A'], env)
  if (add.code !== 0) return add
  return runGit(cwd, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', 'node_modules'], env)
}

/** A commit of the working tree as it stands, made through a private index, so the user's
 *  index, branch, and files are not touched. */
export async function snapshot(cwd: string, run: string): Promise<string> {
  const env = { GIT_INDEX_FILE: join(tmpdir(), `werk-loop-index-${run}`) }
  try {
    await runGit(cwd, ['read-tree', 'HEAD'], env)
    const add = await addAll(cwd, env)
    if (add.code !== 0) throw new Error(`git add failed: ${add.stderr.trim()}`)
    const tree = await runGit(cwd, ['write-tree'], env)
    if (tree.code !== 0) throw new Error(`git write-tree failed: ${tree.stderr.trim()}`)
    const commit = await runGit(cwd, ['commit-tree', tree.stdout.trim(), '-p', 'HEAD', '-m', `werk loop ${run}: base snapshot`])
    if (commit.code !== 0) throw new Error(`git commit-tree failed: ${commit.stderr.trim()}`)
    return commit.stdout.trim()
  } finally {
    rmSync(env.GIT_INDEX_FILE, { force: true })
  }
}

/** One check: a shell command, its exit code the whole verdict (#lp-checks). It runs in its
 *  own process group, so a cap or a stop kills the test runner under `make` too. */
export function runCheck(cwd: string, cmd: string, timeoutMs = CHECK_TIMEOUT_MS, signal?: AbortSignal): Promise<CheckResult> {
  const start = Date.now()
  return new Promise((resolve) => {
    const proc = spawn('sh', ['-c', cmd], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true' }, detached: true })
    let out = ''
    let killed: string | undefined
    let timedOut = false
    const kill = (why: string) => {
      killed = why
      try {
        process.kill(-proc.pid!, 'SIGTERM')
      } catch {
        proc.kill()
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill(`killed after ${timeoutMs}ms`)
    }, timeoutMs)
    const onAbort = () => kill('stopped')
    signal?.addEventListener('abort', onAbort)
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (out += d))
    const done = (r: CheckResult) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(r)
    }
    proc.on('error', (e) => done({ cmd, ok: false, code: -1, ms: Date.now() - start, tail: e.message, output: e.message, infra: `did not start: ${e.message}` }))
    proc.on('exit', (code) => {
      const text = killed ? `${out}\n[${killed}]` : out
      // #ms-fail-cause: the shell's own codes for a command it could not find or run. A stop
      // by the person is not the check's fault, so only the timeout counts.
      const infra = timedOut ? killed : code === 127 ? 'command not found' : code === 126 ? 'command not executable' : undefined
      done({ cmd, ok: !killed && code === 0, code: code ?? -1, ms: Date.now() - start, tail: tail(text), output: text, ...(infra ? { infra } : {}) })
    })
  })
}

export async function loop(
  cwd: string,
  opts: { brief: string; cards: GraphNode[]; checks: string[]; cap: number; passTimeoutMs: number; run?: string },
): Promise<LoopResult> {
  const run = opts.run ?? String(Date.now())
  const branch = `werk-loop/${run}`
  const runsDir = join(cwd, '.werk', 'runs')
  const agentDir = join(runsDir, run)
  const log = join(runsDir, `${run}.jsonl`)
  mkdirSync(agentDir, { recursive: true })
  const started = Date.now()
  const result: LoopResult = { run, base: '', branch, passes: 0, green: false, costUsd: 0, ms: 0, log }

  const worktree = join(tmpdir(), `werk-loop-wt-${run}`)
  try {
    result.base = await snapshot(cwd, run)
    const add = await runGit(cwd, ['worktree', 'add', '-b', branch, worktree, result.base])
    if (add.code !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`)
    if (existsSync(join(cwd, 'node_modules'))) symlinkSync(join(cwd, 'node_modules'), join(worktree, 'node_modules'))

    let lastFailure: CheckResult | undefined
    for (let pass = 1; pass <= opts.cap; pass++) {
      const passStart = Date.now()
      const prompt = freshPrompt({ ...opts, pass, base: result.base, lastFailure })
      const agent = await runHeadless(worktree, prompt, {
        timeoutMs: opts.passTimeoutMs,
        logPath: join(agentDir, `pass-${pass}.jsonl`),
        role: 'builder',
        instructions: true,
      })
      await addAll(worktree)
      await runGit(worktree, ['commit', '--allow-empty', '--no-verify', '-m', `werk loop ${run}: pass ${pass}`])
      const commit = (await runGit(worktree, ['rev-parse', 'HEAD'])).stdout.trim()

      const checks: CheckResult[] = []
      for (const cmd of opts.checks) checks.push(await runCheck(worktree, cmd))
      const green = checks.every((c) => c.ok)
      lastFailure = checks.find((c) => !c.ok)

      const record: PassRecord = {
        run,
        pass,
        at: new Date(passStart).toISOString(),
        ms: Date.now() - passStart,
        costUsd: agent.costUsd,
        turns: agent.turns,
        agentError: agent.error,
        commit,
        checks: checks.map((c) => ({ cmd: c.cmd, ok: c.ok, code: c.code, ms: c.ms })),
        green,
      }
      appendFileSync(log, `${JSON.stringify(record)}\n`)
      result.passes = pass
      result.costUsd += record.costUsd ?? 0
      console.error(`  pass ${pass}: ${green ? 'green' : `red (${lastFailure?.cmd})`}, ${Math.round(record.ms / 1000)}s, $${(record.costUsd ?? 0).toFixed(2)}`)
      if (green) {
        result.green = true
        break
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  } finally {
    // The worktree goes, the branch stays: it is the record of what the passes did.
    const removed = await runGit(cwd, ['worktree', 'remove', '--force', worktree])
    if (removed.code !== 0) {
      rmSync(worktree, { recursive: true, force: true })
      await runGit(cwd, ['worktree', 'prune'])
    }
  }
  result.ms = Date.now() - started
  return result
}
