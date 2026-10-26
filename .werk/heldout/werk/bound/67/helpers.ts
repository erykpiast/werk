import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const REPO = join(import.meta.dir, '..')
const MAIN = join(REPO, 'src', 'cli', 'main.ts')

export type R = { code: number; stdout: string; stderr: string }

export function makeMap() {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-'))
  const dir = join(root, 'project')
  const claude = join(root, 'claude-config')
  mkdirSync(dir)
  mkdirSync(join(claude, 'projects', 'some-project'), { recursive: true })
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: root, CLAUDE_CONFIG_DIR: claude }
  delete env.WERK_LOG
  const werk = (...args: string[]): R => {
    const p = Bun.spawnSync([process.execPath, MAIN, ...args], { cwd: dir, env, stdout: 'pipe', stderr: 'pipe' })
    return { code: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString() }
  }
  const logFile = join(dir, '.werk', 'log.jsonl')
  const logText = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')
  const logLines = () => logText().split('\n').filter((l) => l.trim() !== '')
  const writeSession = (id: string, lines: unknown[]) => {
    const path = join(claude, 'projects', 'some-project', `${id}.jsonl`)
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    return path
  }
  return { root, dir, werk, logFile, logText, logLines, writeSession, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

export const userLine = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
export const assistantLine = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
export const filler = () => ({ type: 'summary', summary: 'filler' })
