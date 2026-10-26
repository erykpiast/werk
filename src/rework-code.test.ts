// Reworked code (#ms-outcome-rework), against a scratch git repository. Behaviours:
// 1. the lines a ticket's commits wrote are found by their subjects, also after a fast-forward;
// 2. a later commit inside the window that changes or removes them counts as rework;
// 3. a change after the window does not count, and a window still open says so;
// 4. a merge whose commits the repository no longer names comes back marked gone.
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reworkedCode } from './rework-code.ts'

const DAY = 24 * 3600 * 1000
const T0 = Date.parse('2026-05-01T10:00:00Z')
const iso = (days: number) => new Date(T0 + days * DAY).toISOString()

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'werk-rework-'))
  const git = (args: string[], date = iso(0)) => {
    const r = spawnSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    })
    if (r.status !== 0) throw new Error(r.stderr)
    return r.stdout.trim()
  }
  git(['init', '-q', '-b', 'main'])
  const commit = (file: string, text: string, subject: string, days: number) => {
    writeFileSync(join(dir, file), text)
    git(['add', file], iso(days))
    git(['commit', '-q', '-m', subject], iso(days))
    return git(['rev-parse', 'HEAD'])
  }
  commit('base.txt', 'base\n', 'start', -1)
  return { dir, git, commit }
}

describe('reworkedCode', () => {
  test('a change inside the window is rework; a change after it is not', () => {
    const r = repo()
    r.commit('a.ts', 'one\ntwo\nthree\n', 'werk build app/01: pass 1', 0)
    const merged = r.commit('a.ts', 'one\ntwo\nthree\nfour\n', 'werk build app/01: pass 2', 0)
    r.commit('a.ts', 'ONE\ntwo\nthree\nfour\n', 'fix the first line', 3)
    r.commit('a.ts', 'ONE\nTWO\nthree\nfour\n', 'change after the window', 20)
    const out = reworkedCode(r.dir, [{ ticket: 'app/01', commit: merged, at: iso(0) }], { now: T0 + 30 * DAY })
    expect(out).toEqual([{ ticket: 'app/01', commit: merged, at: iso(0), lines: 4, changed: 1, open: false }])
  })

  test('a window still open counts up to now, and says it is open', () => {
    const r = repo()
    const merged = r.commit('a.ts', 'one\ntwo\n', 'werk build app/02: pass 1', 0)
    r.commit('a.ts', 'two\n', 'remove a line', 2)
    const out = reworkedCode(r.dir, [{ ticket: 'app/02', commit: merged, at: iso(0) }], { now: T0 + 5 * DAY })
    expect(out[0]).toMatchObject({ lines: 2, changed: 1, open: true })
  })

  test('other tickets\' lines do not count, and a merge with no commit of its own is marked gone', () => {
    const r = repo()
    r.commit('b.ts', 'theirs\n', 'werk build app/09: pass 1', 0)
    const merged = r.commit('a.ts', 'mine\n', 'werk build app/03: pass 1', 0)
    r.commit('b.ts', 'changed\n', 'edit the other ticket', 1)
    const out = reworkedCode(r.dir, [
      { ticket: 'app/03', commit: merged, at: iso(0) },
      { ticket: 'app/04', commit: merged, at: iso(0) },
    ], { now: T0 + 30 * DAY })
    expect(out).toEqual([
      { ticket: 'app/03', commit: merged, at: iso(0), lines: 1, changed: 0, open: false },
      { ticket: 'app/04', commit: merged, at: iso(0), lines: 0, changed: 0, open: false, gone: true },
    ])
  })
})
