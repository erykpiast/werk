import { describe, expect, test } from 'bun:test'
import { DEFAULT_CHECKS, isMakeCheck, PRODUCTION_RUBRIC } from './rubric.ts'

describe('the production rubric (#lp-rubric-prod)', () => {
  test('every check is a make target (#lp-checks-scripts)', () => {
    expect(PRODUCTION_RUBRIC.checks).toEqual(['make test', 'make test-coverage', 'make typecheck', 'make lint', 'make e2e'])
    // An empty `## Checks` section means the rubric's checks: one list (#st-ticket-own-checks).
    expect(DEFAULT_CHECKS).toEqual(PRODUCTION_RUBRIC.checks)
    expect(DEFAULT_CHECKS.every(isMakeCheck)).toBe(true)
    expect(isMakeCheck('bun test')).toBe(false)
    expect(isMakeCheck('make test && rm -rf /')).toBe(false)
  })

  test('five review areas; CRITICAL and HIGH block', () => {
    expect(PRODUCTION_RUBRIC.review.areas.map((a) => a.key)).toEqual(['design', 'maintainability', 'tests', 'security', 'performance'])
    expect(PRODUCTION_RUBRIC.review.blocking).toEqual(['CRITICAL', 'HIGH'])
    expect(PRODUCTION_RUBRIC.judgements.pass).toBe(3)
  })
})
