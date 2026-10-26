import { describe, expect, test } from 'bun:test'
import { SPEC_SECTIONS, specProblem, specStories } from './spec-text.ts'
import { SPEC } from './testing/samples.ts'

describe('reading a spec back', () => {
  test('the numbers of its user stories, in order; none without the section', () => {
    expect(specStories(SPEC)).toEqual([1, 2])
    expect(specStories('## User Stories\n\n1. a\n  3. b\nnot a story\n- 4. bullet\n')).toEqual([1, 3])
    expect(specStories('## Problem Statement\n\nx')).toEqual([])
  })

  test('a complete spec has no problem; a missing section and a story-less spec each say why', () => {
    expect(specProblem(SPEC)).toBeUndefined()
    expect(specProblem('## Problem Statement\n\nx\n')).toBe('missing or empty sections: Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope')
    const noStory = SPEC_SECTIONS.map((h) => `## ${h}\n\n${h === 'User Stories' ? 'A list, but not numbered.' : 'x'}`).join('\n\n')
    expect(specProblem(noStory)).toBe('no numbered user story')
  })
})
