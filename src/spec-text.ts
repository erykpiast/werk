/**
 * The pure half of reading a spec back: its required sections and its user stories. Split
 * from plan.ts so the 90% line gate can hold it — see #werk-test-scope-src0-pure-scope.
 */
import { section } from './ticket.ts'

/** The spec's sections, in order. The first five are required. From the to-spec template. */
export const SPEC_SECTIONS = ['Problem Statement', 'Solution', 'User Stories', 'Implementation Decisions', 'Testing Decisions', 'Out of Scope']

/** The numbers of the spec's user stories. */
export function specStories(spec: string): number[] {
  return section(spec, 'User Stories')
    .split('\n')
    .map((l) => l.match(/^\s*(\d+)\.\s/)?.[1])
    .filter((x): x is string => !!x)
    .map(Number)
}

/** What is wrong with a spec, or undefined when it has every required section and a story. */
export function specProblem(spec: string): string | undefined {
  const missing = SPEC_SECTIONS.filter((h) => !section(spec, h))
  if (missing.length) return `missing or empty sections: ${missing.join(', ')}`
  if (specStories(spec).length === 0) return 'no numbered user story'
  return undefined
}
