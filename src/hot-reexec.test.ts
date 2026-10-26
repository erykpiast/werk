// The role of a serve process (#werk-hmr-swap-serve-reexec). Pure: a wrong role looks like a
// working server, so each branch is checked.
import { describe, expect, test } from 'bun:test'
import { PARENT_ENV, serveRole } from './hot-reexec.ts'

const base = { execPath: '/bin/bun', execArgv: [] as string[], argv: ['/bin/bun', '/w/src/cli.ts', 'serve', '--port', '4100'], env: {} as Record<string, string | undefined>, pid: 42, isBun: true }

describe('the role of a serve process', () => {
  test('a plain serve is a parent whose child runs the same script and arguments with hot reload on', () => {
    const r = serveRole({ ...base, env: { PATH: '/x', GONE: undefined } })
    expect(r).toEqual({ role: 'parent', command: ['/bin/bun', '--hot', '/w/src/cli.ts', 'serve', '--port', '4100'], env: { PATH: '/x', [PARENT_ENV]: '42' } })
  })

  test('a serve that Node started still starts its child with bun', () => {
    const r = serveRole({ ...base, execPath: '/usr/bin/node', isBun: false })
    expect(r.role === 'parent' && r.command[0]).toBe('bun')
  })

  test('a child names its parent and never starts a child of its own', () => {
    expect(serveRole({ ...base, env: { [PARENT_ENV]: '7' } })).toEqual({ role: 'child', parent: 7 })
  })

  test('a serve started by hand under hot reload serves directly', () => {
    expect(serveRole({ ...base, execArgv: ['--hot'] })).toEqual({ role: 'direct' })
  })

  test('a marker that is not a pid is no marker', () => {
    expect(serveRole({ ...base, env: { [PARENT_ENV]: 'x' } }).role).toBe('parent')
    expect(serveRole({ ...base, env: { [PARENT_ENV]: '0' } }).role).toBe('parent')
  })
})
