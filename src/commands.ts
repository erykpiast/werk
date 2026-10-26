import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One entry in the chat composer's `/` menu. */
export type SlashCommand = { name: string; description: string; badge: 'skill' | 'command' | 'built-in' }

/**
 * Every skill and command the chat composer can offer, from the same directories Claude
 * Code itself reads: `.claude/skills` and `.claude/commands`, project first then user, plus
 * a fixed list of the CLI's own built-ins. Project and user entries share one name, so a
 * project skill wins over a user skill of the same name, the same precedence Claude Code
 * itself uses.
 */
export function listSlashCommands(cwd: string): SlashCommand[] {
  const found = new Map<string, SlashCommand>()
  const add = (c: SlashCommand) => {
    if (!found.has(c.name)) found.set(c.name, c)
  }
  for (const c of readSkills(join(cwd, '.claude', 'skills'))) add(c)
  for (const c of readSkills(join(homedir(), '.claude', 'skills'))) add(c)
  for (const c of readCommands(join(cwd, '.claude', 'commands'))) add(c)
  for (const c of readCommands(join(homedir(), '.claude', 'commands'))) add(c)
  for (const c of BUILT_IN) add(c)
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The `description:` line of a Markdown file's YAML frontmatter, if it has one. */
function frontmatterField(text: string, field: string): string {
  const block = text.match(/^---\n([\s\S]*?)\n---/)
  if (!block) return ''
  const line = block[1].split('\n').find((l) => l.startsWith(`${field}:`))
  if (!line) return ''
  return line
    .slice(field.length + 1)
    .trim()
    .replace(/^["']|["']$/g, '')
}

function readSkills(dir: string): SlashCommand[] {
  if (!existsSync(dir)) return []
  const out: SlashCommand[] = []
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'SKILL.md')
    if (!existsSync(file)) continue
    out.push({ name, description: frontmatterField(readFileSync(file, 'utf8'), 'description'), badge: 'skill' })
  }
  return out
}

/** Commands nest in subdirectories; a nested name takes the path as a `foo:bar` prefix. */
function readCommands(dir: string): SlashCommand[] {
  if (!existsSync(dir)) return []
  const out: SlashCommand[] = []
  const walk = (base: string, prefix: string) => {
    for (const entry of readdirSync(base)) {
      const full = join(base, entry)
      if (statSync(full).isDirectory()) {
        walk(full, `${prefix}${entry}:`)
        continue
      }
      if (!entry.endsWith('.md')) continue
      out.push({
        name: `${prefix}${entry.slice(0, -3)}`,
        description: frontmatterField(readFileSync(full, 'utf8'), 'description'),
        badge: 'command',
      })
    }
  }
  walk(dir, '')
  return out
}

/**
 * The CLI's own commands. There is no directory to read these from, so the list is fixed
 * here and kept short: only the ones worth typing from a headless chat pane.
 */
const BUILT_IN: SlashCommand[] = [
  { name: 'agents', description: 'List and manage subagents', badge: 'built-in' },
  { name: 'clear', description: 'Clear the conversation history', badge: 'built-in' },
  { name: 'compact', description: 'Compact the conversation to free context', badge: 'built-in' },
  { name: 'config', description: 'Open configuration settings', badge: 'built-in' },
  { name: 'cost', description: 'Show the cost and duration of the session', badge: 'built-in' },
  { name: 'doctor', description: 'Check the health of the Claude Code install', badge: 'built-in' },
  { name: 'help', description: 'Show help for Claude Code', badge: 'built-in' },
  { name: 'init', description: 'Initialize a CLAUDE.md for this project', badge: 'built-in' },
  { name: 'mcp', description: 'Manage MCP server connections', badge: 'built-in' },
  { name: 'model', description: 'Switch the active model', badge: 'built-in' },
  { name: 'permissions', description: 'Review and edit tool permissions', badge: 'built-in' },
  { name: 'pr-comments', description: 'Fetch review comments on the current PR', badge: 'built-in' },
  { name: 'review', description: 'Review a pull request', badge: 'built-in' },
  { name: 'status', description: 'Show the current session status', badge: 'built-in' },
]
