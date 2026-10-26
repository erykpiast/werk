import { describe, expect, test } from 'bun:test'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCheck } from './loop.ts'
import { MAIN_LINE, mergeTicket } from './merge.ts'
import { git, makeRepo } from './testing/fixture.ts'

/** Commit `files` on `branch`, cut from `from`, and go back to main. */
function commitOn(repo: string, branch: string, from: string, files: Record<string, string>) {
  git(repo, 'checkout', '-q', '-b', branch, from)
  commitHere(repo, files, `on ${branch}`)
  git(repo, 'checkout', '-q', 'main')
}

/** Commit `files` on the branch checked out in `repo`. */
function commitHere(repo: string, files: Record<string, string>, message = 'a commit') {
  for (const [path, content] of Object.entries(files)) writeFileSync(join(repo, path), content)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', message)
}

const worktrees = (repo: string) => git(repo, 'worktree', 'list').split('\n')

describe('the merge queue step (#st-build-run)', () => {
  test('the main line is the branch main', () => {
    expect(MAIN_LINE).toBe('main')
  })

  test('a merge conflict is a red merge, and the main line stays where it was', async () => {
    const repo = makeRepo({ 'a.txt': 'base\n' })
    commitOn(repo, 'werk-build/B1', 'main', { 'a.txt': 'from the ticket\n' })
    commitHere(repo, { 'a.txt': 'from the main line\n' })
    const before = git(repo, 'rev-parse', 'main')
    const m = await mergeTicket(repo, { branch: 'werk-build/B1', ticket: 'r1/01', checks: ['true'] })
    expect(m.green).toBe(false)
    if (m.green || 'checkoutBlocked' in m) throw new Error('expected a red merge')
    expect(m.cmd).toBe('git merge werk-build/B1')
    expect(m.code).not.toBe(0)
    expect(m.tail).toContain('CONFLICT')
    // #st-build-conflict: the result says it was a conflict, not a red check.
    expect(m.conflict).toBe(true)
    // No check ran on a tree that did not merge.
    expect(m.checks).toEqual([])
    expect(git(repo, 'rev-parse', 'main')).toBe(before)
    expect(worktrees(repo)).toHaveLength(1)
  })

  for (const checkedOut of [true, false]) {
    test(`a main line that moved during the checks is never overwritten (${checkedOut ? 'checked out' : 'not checked out'})`, async () => {
      const repo = makeRepo()
      commitOn(repo, 'werk-build/B1', 'main', { 'ticket.txt': 'ticket\n' })
      commitOn(repo, 'elsewhere', 'main', { 'other.txt': 'another merge\n' })
      if (!checkedOut) git(repo, 'checkout', '-q', '--detach')
      const moved = git(repo, 'rev-parse', 'elsewhere')
      // The check itself moves the main line, the way a second merge would mid-check.
      const m = await mergeTicket(repo, { branch: 'werk-build/B1', ticket: 'r1/01', checks: [`git update-ref refs/heads/main ${moved}`] })
      expect(m.green).toBe(false)
      if (m.green || 'checkoutBlocked' in m) throw new Error('expected a red merge')
      expect(m.cmd).toBe(checkedOut ? 'git rev-parse main' : 'git update-ref')
      expect(m.checks.map((c) => c.ok)).toEqual([true])
      expect(git(repo, 'rev-parse', 'main')).toBe(moved)
      expect(git(repo, 'ls-tree', '--name-only', 'main')).not.toContain('ticket.txt')
      expect(worktrees(repo)).toHaveLength(1)
    })
  }

  test('a red check on the merged tree merges, where a conflict does not (#st-build-conflict)', async () => {
    const repo = makeRepo()
    commitOn(repo, 'werk-build/B1', 'main', { 'ticket.txt': 'ticket\n' })
    const m = await mergeTicket(repo, { branch: 'werk-build/B1', ticket: 'r1/01', checks: ['false'] })
    if (!m.green || 'checkoutBlocked' in m) throw new Error('expected a green merge')
    expect(m.failed?.map((c) => c.cmd)).toEqual(['false'])
  })

  test('green with main not checked out moves the branch only', async () => {
    const repo = makeRepo()
    commitOn(repo, 'werk-build/B1', 'main', { 'ticket.txt': 'ticket\n' })
    git(repo, 'checkout', '-q', '--detach')
    const m = await mergeTicket(repo, { branch: 'werk-build/B1', ticket: 'r1/01', checks: ['true'] })
    expect(m).toMatchObject({ green: true })
    if (!m.green) return
    expect(git(repo, 'rev-parse', 'main')).toBe(m.commit)
    expect(git(repo, 'show', 'main:ticket.txt')).toBe('ticket')
  })

  test('green with main checked out in a clean worktree fast-forwards that worktree, files and all', async () => {
    const repo = makeRepo({ 'a.txt': 'base\n' })
    commitOn(repo, 'werk-build/B1', 'main', { 'a.txt': 'from the ticket\n', 'ticket.txt': 'ticket\n' })
    // The main line moved on after the ticket was cut, so the merge is a real merge commit.
    commitHere(repo, { 'main.txt': 'main\n' })
    const m = await mergeTicket(repo, { branch: 'werk-build/B1', ticket: 'r1/01', checks: ['true'] })
    expect(m).toMatchObject({ green: true })
    if (!m.green) return
    expect(git(repo, 'rev-parse', 'main')).toBe(m.commit)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(m.commit)
    expect(git(repo, 'log', '-1', '--format=%s', 'main')).toBe('werk: merge r1/01')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('from the ticket\n')
    expect(readFileSync(join(repo, 'ticket.txt'), 'utf8')).toBe('ticket\n')
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(worktrees(repo)).toHaveLength(1)
  })

  test('a local change in the checkout that blocks the fast-forward moves nothing, and says which checkout', async () => {
    const repo = makeRepo({ 'a.txt': 'base\n' })
    commitOn(repo, 'werk-build/B1', 'main', { 'a.txt': 'from the ticket\n' })
    const before = git(repo, 'rev-parse', 'main')
    writeFileSync(join(repo, 'a.txt'), 'a person is editing this\n')
    const m = await mergeTicket(repo, { branch: 'werk-build/B1', ticket: 'r1/01', checks: ['true'] })
    expect(m.green).toBe(false)
    if (!('checkoutBlocked' in m)) throw new Error('expected a blocked checkout')
    expect(realpathSync(m.checkout)).toBe(realpathSync(repo))
    expect(m.detail).toContain('a.txt')
    expect(m.checks.map((c) => c.ok)).toEqual([true])
    expect(git(repo, 'rev-parse', 'main')).toBe(before)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('a person is editing this\n')
    expect(worktrees(repo)).toHaveLength(1)
  })
})

describe('a red check in the merge queue does not stop the merge (#ms-merge-red-follow-up)', () => {
  test('a red check is run once, the merge goes through, and the red check is named', async () => {
    const repo = makeRepo()
    commitOn(repo, 'werk-build/B1', 'main', { 'ticket.txt': 'ticket\n' })
    const seen: string[] = []
    const m = await mergeTicket(repo, {
      branch: 'werk-build/B1',
      ticket: 'r1/01',
      checks: ['true', 'false', 'true'],
      check: async (tree, cmd) => {
        seen.push(cmd)
        return runCheck(tree, cmd, 10_000)
      },
    })
    expect(m.green).toBe(true)
    if (!m.green || 'checkoutBlocked' in m) throw new Error('expected a green merge')
    expect(m.failed?.map((c) => c.cmd)).toEqual(['false'])
    expect(seen).toEqual(['true', 'false', 'true'])
    expect(git(repo, 'rev-parse', 'main')).toBe(m.commit)
  })

  test('a check that could not run the code does not stop the merge either', async () => {
    const repo = makeRepo()
    commitOn(repo, 'werk-build/B1', 'main', { 'ticket.txt': 'ticket\n' })
    const m = await mergeTicket(repo, {
      branch: 'werk-build/B1',
      ticket: 'r1/01',
      checks: ['no-such-tool-werk'],
      check: async (_tree, cmd) => ({ cmd, ok: false, code: 127, ms: 1, tail: 'not found', infra: 'command not found' }),
    })
    expect(m.green).toBe(true)
    if (!m.green || 'checkoutBlocked' in m) throw new Error('expected a green merge')
    expect(m.failed).toHaveLength(1)
  })

  test('no red check leaves no failed list', async () => {
    const repo = makeRepo()
    commitOn(repo, 'werk-build/B1', 'main', { 'ticket.txt': 'ticket\n' })
    const m = await mergeTicket(repo, { branch: 'werk-build/B1', ticket: 'r1/01', checks: ['true'] })
    expect(m.green && !('checkoutBlocked' in m) && m.failed).toBeUndefined()
  })
})
