/**
 * Where a session's transcript is on disk. Claude Code writes one file per session at
 * `<config dir>/projects/<encoded project dir>/<session>.jsonl`. The config dir is
 * `CLAUDE_CONFIG_DIR`, or `~/.claude` without it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Transcript = { ok: true; path: string; text: string } | { ok: false; message: string }

/** A session id names a file, so it may not hold a path separator or start with a dot. */
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function claudeConfigDir(env: Record<string, string | undefined> = process.env): string {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

/** The directory name Claude Code gives a project: every character outside a-z, A-Z and 0-9 becomes a dash. */
export function encodeProjectDir(projectDir: string): string {
  return projectDir.replace(/[^A-Za-z0-9]/g, '-')
}

/**
 * Reads the transcript of `session`. The project's own directory is looked in first, then
 * every other project directory, so a session that ran in another worktree is found too.
 */
export function readTranscript(session: string, projectDir: string, configDir = claudeConfigDir()): Transcript {
  if (!SESSION.test(session)) return { ok: false, message: `quote: ${JSON.stringify(session)} is not a session id` }
  const projects = join(configDir, 'projects')
  const own = encodeProjectDir(projectDir)
  const others = existsSync(projects) ? readdirSync(projects).filter((dir) => dir !== own).sort() : []
  for (const dir of [own, ...others]) {
    const path = join(projects, dir, `${session}.jsonl`)
    if (existsSync(path)) return { ok: true, path, text: readFileSync(path, 'utf8') }
  }
  return { ok: false, message: `quote: no transcript for session ${session} under ${projects}` }
}
