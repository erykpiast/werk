// The serve verb under hot reload (#werk-hmr-swap-serve-reexec). Hot reload is a runtime flag,
// so a plain serve starts one child that runs with it on. This file decides which role a
// process plays and what the child's command is. It starts nothing.

/** The variable that marks a child. Its value is the parent's pid. */
export const PARENT_ENV = 'WERK_HOT_PARENT'

export type Role =
  | { role: 'direct' }
  | { role: 'child'; parent: number }
  | { role: 'parent'; command: string[]; env: Record<string, string> }

/** A process that already runs under hot reload, or that is a child, serves directly. Any
 *  other process becomes the parent of one child that runs the same script and arguments
 *  with hot reload on. A marker that is not a pid is no marker: the process is a parent. */
export function serveRole(o: {
  execPath: string
  execArgv: string[]
  argv: string[]
  env: Record<string, string | undefined>
  pid: number
  isBun: boolean
}): Role {
  const parent = Number(o.env[PARENT_ENV])
  if (Number.isInteger(parent) && parent > 0) return { role: 'child', parent }
  if (o.execArgv.includes('--hot')) return { role: 'direct' }
  const bun = o.isBun ? o.execPath : 'bun'
  const env = Object.fromEntries(Object.entries(o.env).filter((e): e is [string, string] => e[1] !== undefined))
  return { role: 'parent', command: [bun, '--hot', ...o.argv.slice(1)], env: { ...env, [PARENT_ENV]: String(o.pid) } }
}
