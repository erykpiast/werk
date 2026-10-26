/**
 * The project's target repository: where every ticket builds and merges. See #st-build-target.
 *
 * Werk keeps the map, the board, the specs and the ticket files in its own store, never in the
 * target. `werk target <path>` records the target on the board (`project.target`), and every
 * build, resume, gate and board trigger uses it. There is no default: with no target set, a
 * build is refused.
 */
import { existsSync, realpathSync, statSync } from 'node:fs'
import { dirname, relative, resolve, isAbsolute } from 'node:path'
import { appendBoard, foldBoard, readBoard } from './board.ts'
import { paths } from './project.ts'
import type { Board } from './board.ts'
import { MAIN_LINE, mainLineTip } from './merge.ts'

/** A path as one spelling, so the same directory given two ways compares equal. */
export function canonical(path: string, base: string): string {
  const abs = resolve(base, path)
  return existsSync(abs) ? realpathSync(abs) : abs
}

/** Whether `inner` is `outer` or lies inside it. */
function within(inner: string, outer: string): boolean {
  const r = relative(outer, inner)
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}

/** Why `repo` cannot be the target, when werk's store is `store`: the two must not overlap. */
export function overlapsStore(repo: string, store: string): string | undefined {
  if (within(repo, store)) return `${repo} is inside werk's store ${store}`
  if (within(store, repo)) return `${repo} holds werk's store ${store}: a target is a repository of its own`
  return undefined
}

/** The project's target, or the error a build prints when none is set. */
export function projectTarget(b: Board): { repo: string } | { error: string } {
  return b.target ? { repo: b.target } : { error: 'no target repository is set for this project. Set one with: werk target <path>' }
}

/** The target recorded on the board at `boardPath`. */
export function targetFor(o: { boardPath?: string } = {}): { repo: string } | { error: string } {
  return projectTarget(foldBoard(readBoard(o.boardPath ?? paths.board)))
}

/**
 * Record `given` as the project's target. It must be a directory with the main line, outside
 * werk's store, checked before it is recorded, so a typo is not kept as the target.
 */
export async function setTarget(o: {
  given: string
  cwd: string
  boardPath?: string
  mainLine?: string
}): Promise<{ repo: string } | { error: string }> {
  const boardPath = o.boardPath ?? paths.board
  const repo = canonical(o.given, o.cwd)
  if (!existsSync(repo) || !statSync(repo).isDirectory()) return { error: `${repo} is not a directory` }
  const overlap = overlapsStore(repo, canonical(dirname(boardPath), o.cwd))
  if (overlap) return { error: overlap }
  try {
    await mainLineTip(repo, o.mainLine ?? MAIN_LINE)
  } catch (e) {
    return { error: `${repo}: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (foldBoard(readBoard(boardPath)).target !== repo) appendBoard('project.target', { repo }, { path: boardPath })
  return { repo }
}
