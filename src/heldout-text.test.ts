import { describe, expect, test } from 'bun:test'
import { firstDecision } from './decision-pass.ts'
import { authorPrompt, binderPrompt, BOUND_DIR, changedPaths, changedSources, contradictionPrompt, decisionStepText, followUpText, heldoutDir, holdFile, NO_STEPS, parseContradictions, parseSteps, parseVerdicts, rewritePrompt, sourcesFile, stepName, stepsFile } from './heldout-text.ts'
import type { ParsedTicket } from './ticket.ts'

describe('held-out steps (#lp-heldout-steps)', () => {
  test('splits an answer into scenarios, names an unnamed one, and drops a block with no Then', () => {
    const steps = parseSteps('Here you go:\n```gherkin\nGiven a\nWhen b\nThen c\nGiven d\nWhen e\nThen f\n\nScenario: named\nGiven x\nAnd y\nThen z\n\nGiven only a given\n```')
    expect(steps).toEqual(['Scenario: When b\nGiven a\nWhen b\nThen c', 'Scenario: When e\nGiven d\nWhen e\nThen f', 'Scenario: named\nGiven x\nAnd y\nThen z'])
  })

  test('a step the binder leaves out, or an unknown result, is a binder error', () => {
    const steps = [1, 2, 3].map((i) => ({ id: `01.${i}`, ticket: 'r/01', text: 'x' }))
    expect(parseVerdicts('[{"id":"01.1","result":"pass"},{"id":"01.2","result":"maybe"}]', steps)).toEqual([
      { id: '01.1', result: 'pass', detail: '' },
      { id: '01.2', result: 'binder-error', detail: '' },
      { id: '01.3', result: 'binder-error', detail: 'the binder gave no verdict for this step' },
    ])
    expect(parseVerdicts('all good', steps)).toBe('the binder did not answer with a JSON array')
  })

  test('a follow-up ticket names no file and carries the step word for word', () => {
    const text = followUpText({ steps: [{ id: '01.2', ticket: 'r/01', text: 'Scenario: kept\nGiven a\nThen b' }], cites: ['kid'], checks: ['make test'], touches: ['item store', 'list view'] })
    expect(text).toContain('cites: kid')
    // #st-build-parallel: the follow-up touches what the followed ticket touched.
    expect(text).toContain('touches: item store, list view')
    expect(text).toContain('Scenario: kept\nGiven a\nThen b')
    expect(text).not.toMatch(/^files:/m)
  })
})

describe('where the steps live, and how a step is named', () => {
  test('one steps file per ticket number, under the run, outside any worktree', () => {
    expect(heldoutDir('/repo', 'r1')).toBe('/repo/.werk/heldout/r1')
    expect(stepsFile('/repo', 'r1', 'r1/03')).toBe('/repo/.werk/heldout/r1/03.steps.md')
  })

  test('the source versions sit beside the steps; a changed or gone card, or no record, makes them stale (#st-heldout-step-fresh)', () => {
    expect(sourcesFile('/p', 'r1', 'r1/03')).toBe('/p/.werk/heldout/r1/03.sources.json')
    expect(changedSources({ a: '1', b: '2', c: '3' }, { a: '1', b: '9', d: '4' })).toEqual(['b', 'c'])
    expect(changedSources({ a: '1' }, { a: '1', d: '4' })).toEqual([])
    expect(changedSources(undefined, { a: '1' })).toEqual(['the steps record no source cards'])
  })

  test('a step is named by its id and its scenario line', () => {
    expect(stepName({ id: '01.2', ticket: 'r1/01', text: 'Scenario: an item is kept\nGiven a\nThen b' })).toBe('01.2 an item is kept')
    expect(stepName({ id: '01.3', ticket: 'r1/01', text: 'Given a\nThen b' })).toBe('01.3 Given a')
  })
})

describe('the prompts', () => {
  const ticket: ParsedTicket = { file: '01.md', num: 1, title: 'List', cites: ['kid'], blockedBy: [], stories: [1], touches: ['list'], whatToBuild: 'List, end to end.', acceptance: ['It works'], checks: [], namesFiles: false }

  test('the step author gets the brief, no code, and the scenario rules', () => {
    const p = authorPrompt({ ticket, stories: ['1. As a user, I want to see the list.'], cards: [{ id: 'kid', kind: 'card', title: 'Kid', body: 'Kid body.' }] })
    expect(p).toContain('You are the step author')
    expect(p).toContain('You may not ask a question')
    expect(p).toContain('## The ticket: List')
    expect(p).toContain('List, end to end.')
    expect(p).toContain('- It works')
    expect(p).toContain('1. As a user, I want to see the list.')
    expect(p).toContain('Kid body.')
    expect(authorPrompt({ ticket, stories: [], cards: [] })).toContain('### User stories it delivers\n\n(none)')
  })

  test('the step author rewrites its earlier steps from the current cards, and may drop them all (#st-heldout-step-fresh)', () => {
    const steps = ['Scenario: a drag stops it\nGiven a build\nWhen the person drags it back\nThen the build stops']
    const p = rewritePrompt({ ticket, stories: [], cards: [{ id: 'kid', kind: 'card', title: 'Kid', body: 'Only archive stops a build.' }], steps, changed: ['kid', 'the steps record no source cards'] })
    expect(p).toContain('You are the step author')
    expect(p).toContain('Only archive stops a build.')
    expect(p).toContain('these cards changed or went: #kid, the steps record no source cards')
    expect(p).toContain('Do not add a new scenario')
    expect(p).toContain(`answer with only ${NO_STEPS}`)
    expect(p.endsWith(steps[0])).toBe(true)
  })

  test('the binder gets every step by id, and the directory its tests must stay in', () => {
    const p = binderPrompt([
      { id: '01.1', ticket: 'r1/01', text: 'Scenario: one\nGiven a\nThen b' },
      { id: '02.1', ticket: 'r1/02', text: 'Scenario: two\nGiven c\nThen d' },
    ])
    expect(p).toContain('You are the binder')
    expect(p).toContain(`under \`${BOUND_DIR}/\``)
    expect(p).toContain('### 01.1\n\nTicket: r1/01\n\nScenario: one\nGiven a\nThen b\n\n### 02.1\n\nTicket: r1/02\n\nScenario: two')
  })
})

describe('parseVerdicts, more', () => {
  test('an entry with no id is skipped, and a fail keeps its detail', () => {
    const steps = [{ id: '01.1', ticket: 'r/01', text: 'x' }]
    expect(parseVerdicts('```json\n[{"result":"pass"},{"id":"01.1","result":"fail","detail":"gone"}]\n```', steps)).toEqual([{ id: '01.1', result: 'fail', detail: 'gone' }])
  })
})

describe('followUpText, more', () => {
  test('two failed steps are counted in the title, each with its own criterion and the checks', () => {
    const text = followUpText({
      steps: [
        { id: '01.1', ticket: 'r/01', text: 'Scenario: one\nGiven a\nThen b' },
        { id: '01.2', ticket: 'r/01', text: 'Scenario: two\nGiven c\nThen d' },
      ],
      cites: ['kid', 'base'],
      checks: ['make test', 'make lint'],
    })
    expect(text.split('\n')[0]).toBe('title: Make 2 failed user paths work')
    expect(text).toContain('cites: kid, base')
    expect(text).toContain('- [ ] A user can follow "one" from start to end, or both facts')
    expect(text).toContain('- [ ] A user can follow "two" from start to end, or both facts')
    expect(text).toContain('- `make test`\n- `make lint`')
  })
})

describe('changedPaths (#lp-heldout-binder)', () => {
  test('reads raw paths, so a name git would quote keeps its directory prefix', () => {
    const z = '?? .werk-heldout/test-results/69-72-a person ✓/trace.zip\0 M src/app.ts\0R  new.ts\0old.ts\0'
    expect(changedPaths(z)).toEqual(['.werk-heldout/test-results/69-72-a person ✓/trace.zip', 'src/app.ts', 'new.ts'])
    expect(changedPaths('')).toEqual([])
  })
})

describe('a step through a capability that no merged ticket built (#st-heldout-unbuilt-capability)', () => {
  const steps = [
    { id: '01.1', ticket: 'r1/01', text: 'Scenario: one\nGiven a\nThen b' },
    { id: '01.2', ticket: 'r1/01', text: 'Scenario: two\nGiven c\nThen d' },
  ]

  test('the binder is told the tickets that are not merged, and may answer unbuilt only then', () => {
    expect(binderPrompt(steps)).not.toContain('unbuilt')
    const p = binderPrompt(steps, [{ id: 'r1/02', title: 'Samples run' }])
    expect(p).toContain('answer "unbuilt" and put the ticket\'s id in "owner"')
    expect(p).toContain('- r1/02: Samples run')
    expect(p).toContain('| "unbuilt"')
  })

  test('an unbuilt step keeps its owner when an unmerged ticket other than its own builds the capability', () => {
    const answer = '[{"id":"01.1","result":"unbuilt","owner":"r1/02","detail":"no sample operation"},{"id":"01.2","result":"pass"}]'
    expect(parseVerdicts(answer, steps, ['r1/02'])).toEqual([
      { id: '01.1', result: 'unbuilt', detail: 'no sample operation', owner: 'r1/02' },
      { id: '01.2', result: 'pass', detail: '' },
    ])
  })

  test('a capability the step\'s own ticket forgot, or that no unmerged ticket owns, is a red step', () => {
    const own = '[{"id":"01.1","result":"unbuilt","owner":"r1/01","detail":"x"},{"id":"01.2","result":"unbuilt","owner":"r1/09","detail":"y"}]'
    expect(parseVerdicts(own, steps, ['r1/01', 'r1/02'])).toMatchObject([{ result: 'fail' }, { result: 'fail' }])
    expect(parseVerdicts('[{"id":"01.1","result":"unbuilt","detail":"x"}]', steps, ['r1/02'])).toMatchObject([{ result: 'fail' }, { result: 'binder-error' }])
  })

  test('a follow-up tells its builder to close with no change when both facts hold (#st-heldout-unbuilt-close)', () => {
    const text = followUpText({ steps: [steps[0]], cites: ['kid'], checks: ['make test'] })
    expect(text).toContain('When both facts hold for every path, change no code')
    expect(text).toContain('or both facts above hold for it and a passing unit test at its seam states its outcome')
  })
})

describe('a red step that contradicts its card (#st-heldout-step-contradiction)', () => {
  const ticket = { title: 'T', whatToBuild: 'Build it.', acceptance: ['it works'] } as ParsedTicket
  const red = [{ id: '01.1', ticket: 'r1/01', text: 'Scenario: pos\nGiven a\nThen position 3', detail: 'got 2' }]

  test('the step author reads each red step with what the binder saw', () => {
    const p = contradictionPrompt({ ticket, stories: [], cards: [], red })
    expect(p).toContain('You are the step author')
    expect(p).toContain('### 01.1\n\nScenario: pos\nGiven a\nThen position 3\n\nWhat the binder saw: got 2')
    expect(p).toContain('"verdict": "agrees" | "contradicts"')
  })

  test('only a step marked contradicts counts; an unreadable answer or an unknown id agrees', () => {
    const answer = '```json\n[{"id":"01.1","verdict":"contradicts","card":"#e-card","why":"it says 2"},{"id":"09.9","verdict":"contradicts","card":"x"},{"id":"01.2","verdict":"agrees"}]\n```'
    expect([...parseContradictions(answer, ['01.1', '01.2'])]).toEqual([['01.1', { card: 'e-card', why: 'it says 2' }]])
    expect(parseContradictions('no idea', ['01.1']).size).toBe(0)
    expect(parseContradictions('[{"id":"01.1","verdict":"contradicts"}]', ['01.1']).get('01.1')).toEqual({ card: '', why: '' })
  })

  test('the decision follow-up asks for a decision pass first and cites the contradicted cards', () => {
    const text = decisionStepText({ of: 'r1/01', steps: [{ step: { id: '01.1', ticket: 'r1/01', text: red[0].text }, card: 'e-card', why: 'it says 2' }], cites: ['kid'], checks: ['make test'], touches: ['excerpt'] })
    expect(text.split('\n')[0]).toBe('title: Judge a held-out step against a decided card')
    expect(text).toContain('cites: kid, e-card')
    expect(text).toContain('touches: excerpt')
    expect(firstDecision(text.split('## What to build')[1])).toContain('a held-out step of r1/01 contradicts a decided card')
    expect(text).toContain('It contradicts #e-card: it says 2')
    expect(firstDecision('Build it.')).toBeUndefined()
  })

  test('the hold file sits beside the steps file', () => {
    expect(holdFile('/p', 'r1', 'r1/03')).toBe('/p/.werk/heldout/r1/03.held.json')
  })
})
