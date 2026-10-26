/**
 * The project a piece of code works on (#werk-projects). One server holds many projects at
 * once (#werk-projects-one-process), so a project is not the process's working directory.
 * Each project's work runs inside its own context: a request, an agent child and every
 * callback they start see the project they belong to. Outside any context — the command line
 * — the project is the nearest folder at or above the working directory that holds a map
 * (#werk-cli-name).
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const context = new AsyncLocalStorage<string>()

/** Run `fn` with `root` as the project of everything it starts, now and later. */
export function inProject<T>(root: string, fn: () => T): T {
  return context.run(root, fn)
}

/** The nearest folder at or above `from` with a `.werk` directory, or undefined. */
export function findRoot(from: string): string | undefined {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const werk = join(dir, '.werk')
    if (existsSync(werk) && statSync(werk).isDirectory()) return dir
    if (dirname(dir) === dir) return undefined
  }
}

let cwdRoot: { cwd: string; root: string } | undefined
/** The root folder of the project this code works on. With no map above the working
 *  directory, the working directory itself: a command that needs a map refuses first. */
export function projectRoot(): string {
  const store = context.getStore()
  if (store) return store
  const cwd = process.cwd()
  if (cwdRoot?.cwd !== cwd) cwdRoot = { cwd, root: findRoot(cwd) ?? cwd }
  return cwdRoot.root
}

/** Did the command line find a map? Inside a project context there always is one. */
export const hasMap = () => context.getStore() !== undefined || findRoot(process.cwd()) !== undefined

/** The project's files. Each is read when it is used, so it follows the current project. An
 *  environment value replaces one file for a test. */
export const paths = {
  get log() {
    return process.env.WERK_LOG ?? join(projectRoot(), '.werk', 'log.jsonl')
  },
  /** `.werk`, the folder beside the log. */
  get werk() {
    return dirname(paths.log)
  },
  get attachments() {
    return join(paths.werk, 'attachments')
  },
  get convos() {
    return join(paths.werk, 'conversations')
  },
  get board() {
    return process.env.WERK_BOARD ?? join(projectRoot(), '.werk', 'board.jsonl')
  },
  get tickets() {
    return process.env.WERK_TICKETS ?? join(dirname(paths.board), 'tickets')
  },
  get pipeline() {
    return process.env.WERK_PIPELINE ?? join(projectRoot(), '.werk', 'pipeline.jsonl')
  },
  get foldTimes() {
    return process.env.WERK_FOLD_TIMES ?? join(paths.werk, 'fold-times.jsonl')
  },
  get allow() {
    return join(paths.werk, 'allow.json')
  },
  get asks() {
    return join(paths.werk, 'asks.jsonl')
  },
  get testRuns() {
    return process.env.WERK_TEST_RUNS ?? join(paths.werk, 'test-runs.jsonl')
  },
}
