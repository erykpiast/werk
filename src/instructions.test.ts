import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentEnv, AGENTS_DIR, BIN_DIR, INSTRUCTIONS_PATH, instructionArgs, modelArgs, parseAgent, shippedAgents, systemPrompt } from './instructions.ts'

const project = () => mkdtempSync(join(tmpdir(), 'werk-instr-'))

describe('agent instructions', () => {
  test('a project that is not werk gets the instructions after the extra text', () => {
    const out = systemPrompt(project(), 'EXTRA')
    expect(out.startsWith('EXTRA\n\n')).toBe(true)
    expect(out).toContain('Keep the map current')
  })

  test('the instructions name the CLI as plain werk, the same in every project', () => {
    const out = systemPrompt(project())
    expect(out).not.toContain('src/cli.ts')
    expect(out).toContain('werk add <id>')
  })

  test('every agent finds the werk command first on its PATH', () => {
    const env = agentEnv('chat', { PATH: '/usr/bin' })
    expect(env.PATH).toBe(`${BIN_DIR}:/usr/bin`)
    expect(statSync(join(BIN_DIR, 'werk')).mode & 0o111).toBeGreaterThan(0)
  })

  test('a werk checkout with the same text gets only the extra text, unchanged', () => {
    const dir = project()
    mkdirSync(join(dir, 'prompts'))
    writeFileSync(join(dir, 'prompts', 'agent.md'), readFileSync(INSTRUCTIONS_PATH, 'utf8'))
    expect(systemPrompt(dir, 'node src/cli.ts show x')).toBe('node src/cli.ts show x')
  })

  test('the build-rule titles come last, in a werk checkout too', () => {
    expect(systemPrompt(project(), 'EXTRA', 'RULES').endsWith('\n\nRULES')).toBe(true)
    const dir = project()
    mkdirSync(join(dir, 'prompts'))
    writeFileSync(join(dir, 'prompts', 'agent.md'), readFileSync(INSTRUCTIONS_PATH, 'utf8'))
    expect(systemPrompt(dir, 'EXTRA', 'RULES')).toBe('EXTRA\n\nRULES')
  })

  test('a checkout with different text still gets the instructions', () => {
    const dir = project()
    mkdirSync(join(dir, 'prompts'))
    writeFileSync(join(dir, 'prompts', 'agent.md'), 'older text')
    expect(systemPrompt(dir)).toContain('Keep the map current')
  })

  test('the arguments carry the text and the subagents', () => {
    const args = instructionArgs(project())
    expect(args[0]).toBe('--append-system-prompt')
    expect(args[2]).toBe('--agents')
    expect(Object.keys(JSON.parse(args[3]))).toEqual(['prototyper', 'test-scope'])
  })

  test('a werk checkout gets only the extra text, and no subagents', () => {
    const dir = project()
    mkdirSync(join(dir, 'prompts'))
    writeFileSync(join(dir, 'prompts', 'agent.md'), readFileSync(INSTRUCTIONS_PATH, 'utf8'))
    expect(instructionArgs(dir, 'EXTRA')).toEqual(['--append-system-prompt', 'EXTRA'])
    expect(shippedAgents(dir)).toEqual({})
  })

  test('every shipped subagent names the CLI as plain werk', () => {
    for (const def of Object.values(shippedAgents(project()))) {
      expect(def.prompt + def.description).not.toContain('src/cli.ts')
      expect(def.tools?.length).toBeGreaterThan(0)
    }
  })
})

describe('the shipped prompts', () => {
  // #werk-agent-selfcontained: an agent in another project cannot open a card of werk's map.
  const PLACEHOLDERS = new Set(['#id', '#x', '#y', '#z', '#checkout-retry', '#orders', '#order-format'])
  const files = [INSTRUCTIONS_PATH, ...readdirSync(AGENTS_DIR).map((f) => join(AGENTS_DIR, f))]

  test.each(files)('%s cites no card of werk own map', (file) => {
    const ids = readFileSync(file, 'utf8').match(/#[a-z][a-z0-9:-]*/g) ?? []
    expect(ids.filter((id) => !PLACEHOLDERS.has(id))).toEqual([])
  })

  test.each(files)('%s names no option of a card without the #, either', (file) => {
    // `<id>:opt0` as a pattern in a command is fine; a written-out option id is a citation.
    expect(readFileSync(file, 'utf8').match(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+:opt[\w-]*/g) ?? []).toEqual([])
  })
})

describe('a subagent file', () => {
  test('gives its name, description, tools and prompt', () => {
    const file = '---\nname: a\ndescription: runs werk x\ntools: Read, Bash\n---\n\n# Job\nwerk y\n'
    expect(parseAgent(file)).toEqual(['a', { description: 'runs werk x', tools: ['Read', 'Bash'], prompt: '# Job\nwerk y' }])
  })

  test('without tools leaves them unset, so the subagent gets the default set', () => {
    expect(parseAgent('---\nname: a\ndescription: d\n---\nbody')?.[1].tools).toBeUndefined()
  })

  test('without front matter or a name is not a subagent', () => {
    expect(parseAgent('# just text')).toBeUndefined()
    expect(parseAgent('---\ndescription: d\n---\nbody')).toBeUndefined()
  })
})

describe('the model of each pipeline role (#st-model-per-role)', () => {
  test('the planners and the grader run on Opus', () => {
    for (const role of ['spec-writer', 'ticket-writer', 'grader'] as const) expect(modelArgs(role)).toEqual(['--model', 'claude-opus-5-5'])
  })

  test('the builder runs on Sonnet with an Opus advisor', () => {
    expect(modelArgs('builder')).toEqual(['--model', 'claude-sonnet-5-5', '--advisor', 'claude-opus-5-5'])
  })

  test('the reviewers, the binder, the step author and the classifiers run on Sonnet', () => {
    for (const role of ['reviewer-security', 'binder', 'step-author', 'ask-classifier', 'progress-classifier'] as const) expect(modelArgs(role)).toEqual(['--model', 'claude-sonnet-5-5'])
  })

  test('a role outside the pipeline keeps the Claude Code default', () => {
    for (const role of ['chat', 'prototyper', 'sysdiag-scout'] as const) expect(modelArgs(role)).toEqual([])
  })
})
