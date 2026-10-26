/** Sample plan documents for the pipeline tests. */
import type { FakeRule } from './fake-claude.ts'

/** A grader and reviewers that pass everything, picked by role, not by prompt text
 *  (#st-build-seam-role-env). First, so a builder catch-all does not shadow them. */
export const JUDGES: FakeRule[] = [
  // The sample ticket's one criterion, and kid with base, its closure — #lp-prod-judge.
  { role: 'grader', result: JSON.stringify([{ card: 'criterion-1', score: 4, gap: '' }, { card: 'scope-line', score: 4, gap: '' }, { card: 'kid', score: 4, gap: '' }, { card: 'base', score: 4, gap: '' }]) },
  { role: 'reviewer', result: '[]' },
]


export const SPEC = `## Problem Statement

People lose track.

## Solution

Show it.

## User Stories

1. As a user, I want to see the list, so that I know.
2. As a user, I want to add an item, so that it is kept.

## Implementation Decisions

One module (#root).

## Testing Decisions

At the command line.

## Out of Scope

Sync.
`

/** `touches` defaults to a module named after the title, so two sample tickets with different
 *  titles share no module and may build at the same time (#st-build-parallel). */
export const ticket = (o: { title: string; cites: string; blocked?: string; stories: string; checks?: string; touches?: string }) => `title: ${o.title}
cites: ${o.cites}
blocked_by: ${o.blocked ?? ''}
stories: ${o.stories}
touches: ${o.touches ?? `${o.title.toLowerCase()} module`}

## What to build

${o.title}, end to end.

## Acceptance criteria

- [ ] It works

## Checks

${o.checks ?? '- `make test`'}
`
