/**
 * The e2e server: `bun src/cli.ts serve --port 4941` on a throwaway copy of the fixture .werk.
 *
 * The fixture is copied, not served in place, because the server writes next to the log
 * (serve.lock, attachments/). A fake `claude` goes first on PATH, the same one `bun test`
 * uses, so nothing a spec does can reach a real agent — see #werk-test-visual.
 */
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = process.env.WERK_E2E_PORT ?? '4941'
const root = join(import.meta.dir, '..')
const dir = mkdtempSync(join(tmpdir(), 'werk-e2e-'))
cpSync(join(import.meta.dir, 'fixtures', 'werk'), join(dir, '.werk'), { recursive: true })

// #vi-flow-ms-tests: three recorded unit test runs, dated now so they fall in the default window.
const run = (minutesAgo: number, failed: object[]) => JSON.stringify({ at: new Date(Date.now() - minutesAgo * 60_000).toISOString(), tests: 100, failed })
const slow = { name: 'a classifier that times out counts as not looping', file: 'src/overseer.test.ts', ms: 303, timeout: true, message: 'test timed out after 300ms' }
writeFileSync(join(dir, '.werk', 'test-runs.jsonl'), [run(120, []), run(60, [slow]), run(10, [slow, { name: 'a plain assertion', file: 'src/a.test.ts', ms: 2, timeout: false, message: 'Expected: 2' }])].join('\n') + '\n')

const bin = join(dir, 'bin')
mkdirSync(bin)
writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec bun ${JSON.stringify(join(root, 'src', 'test', 'fake-claude.ts'))} "$@"\n`)
chmodSync(join(bin, 'claude'), 0o755)

// #werk-projects-add: a project needs a git repository. The list is the fixture's own.
Bun.spawnSync(['git', 'init', '-q'], { cwd: dir })
const server = Bun.spawn(['bun', join(root, 'src', 'cli.ts'), 'serve', '--port', PORT], {
  cwd: dir,
  env: { ...process.env, WERK_LOG: join(dir, '.werk', 'log.jsonl'), WERK_CONFIG_DIR: join(dir, 'config'), WERK_DEV: '', PATH: `${bin}:${process.env.PATH}` },
  stdout: 'inherit',
  stderr: 'inherit',
})

const stop = () => {
  server.kill('SIGTERM')
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
const code = await server.exited
rmSync(dir, { recursive: true, force: true })
process.exit(code ?? 0)
