/**
 * The production rubric, built into the tool. See #lp-rubric, #lp-rubric-prod.
 *
 * Constants, not files in the project being judged and not derived per ticket. Three
 * sections: checks (#lp-prod-checks), judgements (#lp-prod-judge) and the quality review
 * (#lp-prod-review). The held-out set (#lp-prod-heldout) belongs to the merge loop.
 */

/** #lp-prod-checks names five roles. #lp-checks-scripts binds each to a make target, so the
 *  rubric holds the name and the project's Makefile holds the command. */
export const CHECK_TARGETS = ['test', 'test-coverage', 'typecheck', 'lint', 'e2e'] as const

/** The checks a ticket gets when its `## Checks` section is empty: the rubric's own check
 *  section, one list (#st-ticket-own-checks, #lp-checks-scripts). */
export const DEFAULT_CHECKS: readonly string[] = CHECK_TARGETS.map((t) => `make ${t}`)

/** #lp-checks-scripts: every check line is `make <target>`. */
export function isMakeCheck(cmd: string): boolean {
  return /^make [A-Za-z0-9_.:-]+$/.test(cmd.trim())
}

/** #lp-prod-judge: a score is 1-5, and a 3 passes. */
export const GRADE_PASS = 3

/** #lp-prod-review: five areas, one fresh reviewer each. Fixed, the same for every project. */
export const REVIEW_AREAS = [
  { key: 'design', title: 'Design', ask: 'module boundaries, coupling, error handling, fit with the code around it' },
  {
    key: 'maintainability',
    title: 'Maintainability',
    ask: 'duplication, complexity, dead code, escape hatches such as type or lint suppressions and skipped tests',
  },
  {
    key: 'tests',
    title: 'Tests',
    ask: 'assertions that fail without the change, edge cases, failure paths, and any test that the change made weaker',
  },
  { key: 'security', title: 'Security and dependencies', ask: 'input validation, secret handling, each new dependency and the reason for it' },
  { key: 'performance', title: 'Performance', ask: 'extra work, expensive queries, unbounded loops on the input' },
] as const

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
export type Severity = (typeof SEVERITIES)[number]

/** CRITICAL and HIGH fail the pass. MEDIUM and LOW are recorded and do not block. */
export const BLOCKING: readonly Severity[] = ['CRITICAL', 'HIGH']

/** The production rubric as one value, its sections in the order the builder loop runs them. */
export const PRODUCTION_RUBRIC = {
  checks: DEFAULT_CHECKS,
  judgements: { pass: GRADE_PASS, scale: [1, 5] as const },
  review: { areas: REVIEW_AREAS, blocking: BLOCKING },
} as const
