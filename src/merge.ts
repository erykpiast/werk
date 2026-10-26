/**
 * The merge queue's one step: try a ticket on the main line. See #st-build-run.
 *
 *   1. A temporary tree: the main line's tip plus the ticket branch.
 *   2. The ticket's checks run on it, one command each, exit code only (#lp-checks).
 *   3. The main line moves to the temporary tree's commit, red checks or not
 *      (#ms-merge-red-follow-up). A conflict moves nothing.
 *
 * Tickets build from and merge onto the main line, the branch `main`, with no integration
 * branch of their own (#st-plan-main, #werk-base-branch). The temporary tree is a detached
 * worktree, removed afterwards whatever happens.
 *
 * The main line moves only from the value it had before the checks, so a main line that
 * changed under the check is never overwritten. When `main` is checked out in a worktree, the
 * move is a fast-forward inside that worktree, so its files follow the branch. A checkout
 * that blocks the fast-forward is not the ticket's fault: nothing moves, and the result says
 * which checkout and why, so the run stops instead of sending the ticket back.
 *
 * `cwd` is the target repository (#st-build-target): the main line, the temporary tree and
 * the checkout are all its own.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHECK_TIMEOUT_MS, runCheck, tail } from './loop.ts'
import type { CheckResult } from './loop.ts'
import { runGit } from './prototype.ts'

/** The branch every build starts from and every merge moves (#st-plan-main, #werk-base-branch). */
export const MAIN_LINE = 'main'

/** The tip of the main line. Throws when the branch does not exist. */
export async function mainLineTip(cwd: string, mainLine: string = MAIN_LINE): Promise<string> {
  const r = await runGit(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${mainLine}`])
  if (r.code !== 0) throw new Error(`no main line branch ${mainLine}`)
  return r.stdout.trim()
}

/** The worktree that has the branch checked out, if one has. */
export async function checkoutOf(cwd: string, branch: string): Promise<string | undefined> {
  const list = await runGit(cwd, ['worktree', 'list', '--porcelain'])
  for (const block of list.stdout.split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const path = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length)
    if (path && lines.includes(`branch refs/heads/${branch}`)) return path
  }
  return undefined
}

export type MergeResult =
  /** `failed`: the checks that were red. They do not stop the merge, and each becomes part of a
   *  follow-up ticket (#ms-merge-red-follow-up). */
  | { green: true; commit: string; checks: CheckResult[]; failed?: CheckResult[] }
  /** Red on the ticket: a conflict, a red check, or a main line that moved under the checks.
   *  `conflict`: git could not merge the branch, so no check ran (#st-build-conflict). A red
   *  check is not one of these: it merges (#ms-merge-red-follow-up). */
  | { green: false; cmd: string; code: number; tail: string; checks: CheckResult[]; conflict?: true }
  /** Green on the ticket, but the checkout of the main line refused the fast-forward. */
  | { green: false; checkoutBlocked: true; checkout: string; commit: string; detail: string; checks: CheckResult[] }

/** A stage after the checks (#st-heldout-followup-gate): runs on the temporary tree's commit and
 *  returns the failure that stops the merge, or nothing. */
export type GateStage = (commit: string) => Promise<{ cmd: string; code: number; tail: string } | undefined>

export async function mergeTicket(
  cwd: string,
  o: {
    branch: string
    ticket: string
    checks: string[]
    mainLine?: string
    checkTimeoutMs?: number
    signal?: AbortSignal
    /** Runs one check in place of a bare run, so the caller can record it (#ms-store-files). */
    check?: (tree: string, cmd: string, i: number, timeoutMs: number, signal?: AbortSignal) => Promise<CheckResult>
    /** Runs once the checks are green, before the main line moves (#st-heldout-followup-gate). */
    gate?: GateStage
  },
): Promise<MergeResult> {
  const mainLine = o.mainLine ?? MAIN_LINE
  const before = await mainLineTip(cwd, mainLine)
  const tree = mkdtempSync(join(tmpdir(), 'werk-merge-wt-'))
  const checks: CheckResult[] = []
  try {
    const add = await runGit(cwd, ['worktree', 'add', '--detach', tree, before])
    if (add.code !== 0) return { green: false, cmd: 'git worktree add', code: add.code, tail: tail(add.stderr), checks }
    const merge = await runGit(tree, ['merge', '--no-edit', '-m', `werk: merge ${o.ticket}`, o.branch])
    if (merge.code !== 0) return { green: false, cmd: `git merge ${o.branch}`, code: merge.code, tail: tail(`${merge.stdout}\n${merge.stderr}`), checks, conflict: true }
    const check = o.check ?? ((tree, cmd, _i, timeoutMs, signal) => runCheck(tree, cmd, timeoutMs, signal))
    for (const [i, cmd] of o.checks.entries()) {
      // #ms-merge-red-follow-up: every check runs once, and a red one does not stop the merge.
      // A stop of the person does: no verdict of the checks is left to merge on.
      checks.push(await check(tree, cmd, i, o.checkTimeoutMs ?? CHECK_TIMEOUT_MS, o.signal))
      if (o.signal?.aborted) break
    }
    const failed = checks.filter((c) => !c.ok)
    if (o.signal?.aborted) return { green: false, cmd: 'stopped', code: 1, tail: 'the run was stopped during the checks', checks }
    const commit = (await runGit(tree, ['rev-parse', 'HEAD'])).stdout.trim()
    const stopped = await o.gate?.(commit)
    if (stopped) return { green: false, ...stopped, checks }

    const checkout = await checkoutOf(cwd, mainLine)
    if (!checkout) {
      const moved = await runGit(cwd, ['update-ref', `refs/heads/${mainLine}`, commit, before])
      if (moved.code !== 0) return { green: false, cmd: 'git update-ref', code: moved.code, tail: tail(moved.stderr), checks }
      return { green: true, commit, checks, ...(failed.length ? { failed } : {}) }
    }
    // The fast-forward has no compare-and-swap of its own: compare first.
    const now = (await runGit(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${mainLine}`])).stdout.trim()
    if (now !== before) return { green: false, cmd: `git rev-parse ${mainLine}`, code: 1, tail: `${mainLine} moved during the checks: ${before.slice(0, 8)} is now ${now.slice(0, 8) || 'gone'}`, checks }
    const ff = await runGit(checkout, ['merge', '--ff-only', commit])
    if (ff.code !== 0) {
      const detail = `${ff.stderr}\n${ff.stdout}`.trim() || `git merge --ff-only exited ${ff.code}`
      return { green: false, checkoutBlocked: true, checkout, commit, detail: tail(detail), checks }
    }
    return { green: true, commit, checks, ...(failed.length ? { failed } : {}) }
  } finally {
    const removed = await runGit(cwd, ['worktree', 'remove', '--force', tree])
    if (removed.code !== 0) {
      rmSync(tree, { recursive: true, force: true })
      await runGit(cwd, ['worktree', 'prune'])
    }
  }
}
