import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foldBoard, readBoard } from './board.ts'
import type { BoardEvent } from './board.ts'
import { overlapsStore, projectTarget, setTarget, targetFor } from './target.ts'
import { git, makeRepo } from './testing/fixture.ts'

const board = (...repos: string[]) =>
  foldBoard(repos.map((repo, i) => ({ seq: i + 1, at: '', actor: 'agent', type: 'project.target', payload: { repo } }) as BoardEvent))

describe('projectTarget (#st-build-target)', () => {
  test('nothing set: an error that names werk target, and no default', () => {
    expect(projectTarget(board())).toEqual({ error: 'no target repository is set for this project. Set one with: werk target <path>' })
  })

  test('the last target set holds', () => {
    expect(projectTarget(board('/a', '/b'))).toEqual({ repo: '/b' })
  })
})

describe('overlapsStore', () => {
  test('a repository apart from the store is fine', () => {
    expect(overlapsStore('/projects/app', '/werk/.werk')).toBeUndefined()
  })

  test('the store itself, a path inside it, or a repository that holds it is refused', () => {
    expect(overlapsStore('/werk/.werk', '/werk/.werk')).toContain('inside')
    expect(overlapsStore('/werk/.werk/x', '/werk/.werk')).toContain('inside')
    expect(overlapsStore('/werk', '/werk/.werk')).toContain('holds')
  })

  test('a sibling whose name starts like the store is not inside it', () => {
    expect(overlapsStore('/werk/.werk-app', '/werk/.werk')).toBeUndefined()
  })
})

describe('setTarget', () => {
  const store = () => join(mkdtempSync(join(tmpdir(), 'werk-store-')), 'board.jsonl')

  test('records the target once, as an absolute path, and the build reads it', async () => {
    const boardPath = store()
    const target = realpathSync(makeRepo())
    expect(await setTarget({ given: target, cwd: '/', boardPath })).toEqual({ repo: target })
    expect(await setTarget({ given: target, cwd: '/', boardPath })).toEqual({ repo: target })
    expect(targetFor({ boardPath })).toEqual({ repo: target })
    expect(readBoard(boardPath).map((e) => [e.type, e.payload])).toEqual([['project.target', { repo: target }]])
  })

  test('a path that is not a directory, or has no main line, is refused and not recorded', async () => {
    const boardPath = store()
    expect(await setTarget({ given: '/no/such/dir', cwd: '/', boardPath })).toEqual({ error: '/no/such/dir is not a directory' })
    const trunk = realpathSync(makeRepo())
    git(trunk, 'branch', '-m', 'main', 'trunk')
    expect(await setTarget({ given: trunk, cwd: '/', boardPath })).toEqual({ error: `${trunk}: no main line branch main` })
    expect(readBoard(boardPath)).toEqual([])
  })

  test("the repository that holds werk's store is refused", async () => {
    const repo = realpathSync(makeRepo())
    mkdirSync(join(repo, '.werk'))
    const boardPath = join(repo, '.werk', 'board.jsonl')
    const r = await setTarget({ given: '.', cwd: repo, boardPath })
    expect(r).toEqual({ error: `${repo} holds werk's store ${join(repo, '.werk')}: a target is a repository of its own` })
    expect(readBoard(boardPath)).toEqual([])
  })
})
