/**
 * Loaded by bunfig.toml before any test file. Two guarantees for the whole run:
 *
 * 1. WERK_LOG and WERK_BOARD point into a scratch directory. Every project file a test
 *    touches without a path of its own — the log, the board, the conversations, allow.json
 *    and asks.jsonl — is found from these, so they have to be set before any test runs.
 * 2. A fake `claude` is first on PATH. Anything that spawns `claude` gets the script in
 *    fake-claude.ts, never the real CLI. See #werk-test-behaviours-agent.
 * 3. One happy-dom window is registered before any test file loads, so React finds a DOM.
 *    The runtime's network, stream and timer globals are put back after it, so a server
 *    test gets Bun's fetch, not the DOM's. The document is emptied after every test, also
 *    when the test fails. See #werk-test-globals and #werk-test-dom.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'werk-test-'))
const werk = join(root, '.werk')
mkdirSync(werk, { recursive: true })
process.env.WERK_LOG = join(werk, 'log.jsonl')
process.env.WERK_BOARD = join(werk, 'board.jsonl')
process.env.WERK_PIPELINE = join(werk, 'pipeline.jsonl')
process.env.WERK_TEST_ROOT = root
// The project list lives in the person's own config folder. A test never touches it.
process.env.WERK_CONFIG_DIR = join(root, 'config')
delete process.env.WERK_DEV

const bin = join(root, 'bin')
mkdirSync(bin, { recursive: true })
const fake = join(bin, 'claude')
writeFileSync(fake, `#!/bin/sh\nexec bun ${JSON.stringify(join(import.meta.dir, 'fake-claude.ts'))} "$@"\n`)
chmodSync(fake, 0o755)
process.env.PATH = `${bin}:${process.env.PATH}`
process.env.WERK_FAKE_BIN = bin

// The globals server code needs from the runtime. happy-dom brings its own of each.
const RUNTIME_GLOBALS = [
  'fetch', 'Request', 'Response', 'Headers', 'FormData', 'File', 'Blob', 'URL', 'WebSocket',
  'AbortController', 'AbortSignal', 'ReadableStream', 'WritableStream', 'TransformStream',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
] as const
const g = globalThis as Record<string, unknown>
const runtime = new Map(RUNTIME_GLOBALS.map(k => [k, g[k]]))
GlobalRegistrator.register()
for (const [k, v] of runtime) g[k] = v

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})
