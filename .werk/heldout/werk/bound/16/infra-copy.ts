// A throwaway copy of the werk repository (git HEAD) with v0's packages installed.
// werk v0 — the product the 01.x steps describe — lives in v0/ of the repository.
// Every step that edits, installs or writes runs in a copy, so the checkout stays unchanged.
import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO } from './helpers.ts'

export function copyRepo(prefix = 'werk-ho-copy-'): { root: string; v0: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  execSync(`git -C ${JSON.stringify(REPO)} archive HEAD | tar -x -C ${JSON.stringify(root)}`)
  const v0 = join(root, 'v0')
  const r = spawnSync('bun', ['install', '--frozen-lockfile'], { cwd: v0, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`bun install failed in the copy:\n${r.stdout}${r.stderr}`)
  return { root, v0 }
}
