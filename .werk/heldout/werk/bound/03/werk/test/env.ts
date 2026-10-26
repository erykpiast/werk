import { join } from 'node:path'

/** The directory that holds the fake `claude`. */
export const FAKE_AGENT_DIR = join(import.meta.dirname, 'fake-agent')

/** The root of the werk package: src/cli.ts sits under it. */
export const WERK_ROOT = join(import.meta.dirname, '..')

export const CLI = join(WERK_ROOT, 'src', 'cli.ts')

/**
 * The environment for every process a test starts: the fake agent first on PATH, and no
 * variable that could point werk at a real project's files.
 */
export function testEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('WERK_')) continue
    env[key] = value
  }
  const rest = (env.PATH ?? '').split(':').filter((p) => p && p !== FAKE_AGENT_DIR)
  env.PATH = [FAKE_AGENT_DIR, ...rest].join(':')
  return { ...env, ...extra }
}
