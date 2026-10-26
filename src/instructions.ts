/**
 * The werk agent instructions, for every agent werk starts that can write to the map, in any
 * project (#werk-agent-instructions), and the subagents they name (#werk-agent-subagents). The
 * text lives in Markdown files (#pr-logic); this module only reads them and fits them to the
 * repository the agent runs in.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

const PROMPTS = join(import.meta.dirname, '..', 'prompts')
export const INSTRUCTIONS_PATH = join(PROMPTS, 'agent.md')
export const AGENTS_DIR = join(PROMPTS, 'agents')
/** #werk-cli-name: the folder that holds the `werk` command every agent calls. Run from source,
 *  it is the checkout's own bin/, whose launcher runs this checkout's CLI. A compiled werk is
 *  the command itself. */
export const BIN_DIR = existsSync(join(import.meta.dirname, '..', 'bin', 'werk')) ? join(import.meta.dirname, '..', 'bin') : dirname(process.execPath)

function read(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** A werk checkout with the same instructions: its own instruction file imports the text and
 *  its own agent directory holds the subagents, so Claude Code reads both there already. */
function isWerkCheckout(cwd: string, text: string): boolean {
  const local = join(cwd, 'prompts', 'agent.md')
  return existsSync(local) && read(local) === text
}

/** The system prompt to append for a `claude` child that runs in `cwd`: `extra`, the
 *  instructions, and the project's build-rule titles (#st-build-howto-titles). The
 *  instructions name the CLI as plain `werk` (#werk-cli-name), so the text is the same in every
 *  project. A werk checkout already reads them, so it gets `extra` and the rules only. A
 *  missing file leaves the instructions out, so a broken install starts agents with less
 *  guidance instead of not starting them. */
export function systemPrompt(cwd: string, extra = '', rules = ''): string {
  const text = read(INSTRUCTIONS_PATH)
  const own = text === undefined || isWerkCheckout(cwd, text) ? '' : text
  return [extra, own, rules].filter(Boolean).join('\n\n')
}

export type AgentDef = { description: string; prompt: string; tools?: string[] }

/** One subagent file: a front matter of `name`, `description` and `tools`, then the prompt. */
export function parseAgent(file: string): [string, AgentDef] | undefined {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(file)
  if (!m) return undefined
  const field = (k: string) => new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(m[1])?.[1].trim()
  const name = field('name')
  const description = field('description')
  if (!name || !description) return undefined
  const tools = field('tools')
  const def: AgentDef = { description, prompt: m[2].trim() }
  if (tools) def.tools = tools.split(',').map((t) => t.trim()).filter(Boolean)
  return [name, def]
}

/** The subagents that ship with the instructions, by name. Empty in a werk checkout. */
export function shippedAgents(cwd: string): Record<string, AgentDef> {
  const text = read(INSTRUCTIONS_PATH)
  if (text === undefined || isWerkCheckout(cwd, text)) return {}
  let files: string[]
  try {
    files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'))
  } catch {
    return {}
  }
  const out: Record<string, AgentDef> = {}
  for (const f of files.sort()) {
    const parsed = parseAgent(read(join(AGENTS_DIR, f)) ?? '')
    if (parsed) out[parsed[0]] = parsed[1]
  }
  return out
}

/** The CLI arguments that hand `systemPrompt` and `shippedAgents` to a `claude` child. Each
 *  flag is left out when it would be empty. */
export function instructionArgs(cwd: string, extra = '', rules = ''): string[] {
  const text = systemPrompt(cwd, extra, rules)
  const agents = shippedAgents(cwd)
  return [
    ...(text ? ['--append-system-prompt', text] : []),
    ...(Object.keys(agents).length ? ['--agents', JSON.stringify(agents)] : []),
  ]
}

/**
 * #st-build-seam-role-env: every agent werk starts carries its role, a short fixed word for its
 * job, in this environment variable. The real agent ignores it; the test fake reads it to pick
 * the reply a test scripted for that role, and how long it lives (#werk-chat-fake-role). A new
 * kind of agent gets a new role here.
 */
export const ROLE_ENV = 'WERK_ROLE'
export type AgentRole =
  | 'chat'
  | 'builder'
  | 'grader'
  | 'reviewer'
  | `reviewer-${string}`
  | 'ask-classifier'
  | 'progress-classifier'
  | 'spec-writer'
  | 'ticket-writer'
  | 'step-author'
  | 'binder'
  | 'prototyper'
  | 'sampler'
  | 'clusterer'
  | 'sysdiag-scout'
  | 'sysdiag-updater'

/** #st-build-seam-role-env-reviewer-area: the role of the reviewer of one quality area, the word
 *  reviewer, a dash and the area's short word. The five reviewers of a pass run at once, so a
 *  test tells them apart by this name, not by launch order or prompt text. */
export const reviewerRole = (area: string): AgentRole => `reviewer-${area}`

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'

/** #st-model-per-role: the model of each pipeline role. Opus where a mistake costs every later
 *  step (the plan) or where the result is judged (the grader); Sonnet with an Opus advisor for
 *  the builder; Sonnet for the narrow and mechanical roles. A role not named here gets the
 *  Claude Code default. */
export function modelArgs(role: AgentRole): string[] {
  if (role === 'spec-writer' || role === 'ticket-writer' || role === 'grader') return ['--model', OPUS]
  if (role === 'builder') return ['--model', SONNET, '--advisor', OPUS]
  if (role === 'reviewer' || role.startsWith('reviewer-') || role === 'binder' || role === 'step-author') return ['--model', SONNET]
  if (role === 'ask-classifier' || role === 'progress-classifier') return ['--model', SONNET]
  return []
}

/** The environment for an agent child process: the parent's, with `extra`, the role, and the
 *  `werk` command first on PATH (#werk-cli-name). */
export function agentEnv(role: AgentRole, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra }
  return { ...env, PATH: [BIN_DIR, env.PATH].filter(Boolean).join(delimiter), [ROLE_ENV]: role }
}
