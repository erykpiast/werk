/**
 * Reworked code (#ms-outcome-rework): the lines a ticket's merge put on the main line that a
 * later commit changed or removed within 14 days. Nothing is recorded at merge time. The fold
 * starts from the merge commit the board holds for each ticket, and asks the repository when
 * the report runs.
 *
 * A merge can be a fast-forward, so the merge commit does not mark where the ticket starts.
 * The ticket's own commits are found by their subjects: each builder pass and the merge commit
 * name the ticket. `git blame` at the merge counts the lines those commits wrote; `git blame` at
 * the last main-line commit inside the window counts how many of them are still there.
 */
import { spawnSync } from 'node:child_process'
import { blamedLines, REWORK_DAYS, ticketCommitPattern, type ReworkedCode } from './outcomes.ts'
import { MAIN_LINE } from './merge.ts'

const DAY_MS = 24 * 3600 * 1000

function git(repo: string, args: string[]): string | null {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return r.status === 0 ? r.stdout : null
}

/** The lines `commits` wrote in `files`, as `rev` holds them. A file `rev` lacks has none. */
function linesAt(repo: string, rev: string, files: string[], commits: Set<string>): number {
  let n = 0
  for (const file of files) {
    const out = git(repo, ['blame', '--line-porcelain', rev, '--', file])
    if (out) n += blamedLines(out, commits)
  }
  return n
}

export function reworkedCode(
  repo: string,
  merges: { ticket: string; commit: string; at: string }[],
  o: { now?: number; mainLine?: string; days?: number } = {},
): ReworkedCode[] {
  const now = o.now ?? Date.now()
  const windowMs = (o.days ?? REWORK_DAYS) * DAY_MS
  const out: ReworkedCode[] = []
  for (const m of merges) {
    const own = git(repo, ['log', '--format=%H', '-E', `--grep=${ticketCommitPattern(m.ticket)}`, m.commit])
    const commits = new Set((own ?? '').split('\n').filter(Boolean))
    if (commits.size === 0) {
      out.push({ ticket: m.ticket, commit: m.commit, at: m.at, lines: 0, changed: 0, open: false, gone: true })
      continue
    }
    const files = new Set<string>()
    for (const c of commits) for (const f of (git(repo, ['show', '--format=', '--name-only', c]) ?? '').split('\n')) if (f) files.add(f)
    const lines = linesAt(repo, m.commit, [...files], commits)
    const end = Date.parse(m.at) + windowMs
    const open = now < end
    // The main line as it was when the window closed, or now while it is open.
    const rev = (git(repo, ['rev-list', '-1', `--before=${new Date(Math.min(end, now)).toISOString()}`, o.mainLine ?? MAIN_LINE]) ?? '').trim()
    const still = rev ? linesAt(repo, rev, [...files], commits) : lines
    out.push({ ticket: m.ticket, commit: m.commit, at: m.at, lines, changed: Math.max(0, lines - still), open })
  }
  return out
}
