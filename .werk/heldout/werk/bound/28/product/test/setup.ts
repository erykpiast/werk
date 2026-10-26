/**
 * Loaded by bunfig.toml before every test file.
 *
 * 1. The environment. The fake agent goes first on PATH, and every WERK_ variable from the
 *    shell that ran the tests is removed. No test reaches a real agent or a real project.
 *    Bun's own spawn, which and shell read the environment the process started with, not
 *    process.env, so they are made to default to process.env here.
 * 2. A DOM for React component tests, from happy-dom, for the whole run. Bun's own network,
 *    stream and timer globals are put back after it, so server tests use the real ones.
 */
import { afterEach } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { testEnv } from './env.ts'

for (const key of Object.keys(process.env)) {
  if (key.startsWith('WERK_')) delete process.env[key]
}
process.env.PATH = testEnv().PATH

type SpawnFn = (...args: unknown[]) => unknown
const withEnv = (spawn: SpawnFn): SpawnFn => (first, second) =>
  Array.isArray(first)
    ? spawn(first, { env: process.env, ...(second as object | undefined) })
    : spawn({ env: process.env, ...(first as object) })
const which = Bun.which
Object.assign(Bun, {
  spawn: withEnv(Bun.spawn as SpawnFn),
  spawnSync: withEnv(Bun.spawnSync as SpawnFn),
  which: (command: string, options?: { PATH?: string; cwd?: string }) => which(command, { PATH: process.env.PATH, ...options }),
})
Bun.$.env(process.env)

const KEEP_FROM_BUN = [
  'fetch', 'Request', 'Response', 'Headers', 'FormData', 'Blob', 'File', 'WebSocket',
  'AbortController', 'AbortSignal', 'URL', 'URLSearchParams',
  'ReadableStream', 'WritableStream', 'TransformStream', 'TextEncoder', 'TextDecoder',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'queueMicrotask', 'structuredClone', 'crypto', 'performance', 'console',
] as const
const bun = Object.fromEntries(KEEP_FROM_BUN.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
GlobalRegistrator.register({ url: 'http://localhost/' })
for (const [key, descriptor] of Object.entries(bun)) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor)
}

const { cleanup } = await import('@testing-library/react')
afterEach(cleanup)
