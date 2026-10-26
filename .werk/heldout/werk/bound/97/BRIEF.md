# Binder brief (shared by every group)

You bind held-out Given/When/Then steps to tests. Repository root: the parent of this folder
(`.werk-heldout/`). The project is "werk": a Bun + TypeScript CLI (`src/cli/main.ts`, verbs in
`src/cli/verbs/`), a server (`src/server/`), a React web app (`web/src/`), Playwright specs (`e2e/`).

## Hard rules
1. Never change the text of a step. Map it to actions and checks only.
2. Do not make a test pass. When a test fails because the product does not do what the step says,
   record the failure and move on. Fix only your own errors (wrong name, typo, wrong selector).
3. NEVER change, create or delete any file outside `.werk-heldout/`. A change there voids the report.
   If a step needs to modify the repo (e.g. delete tests, add a verb module), copy the repo to a
   temporary directory (e.g. `git clone` of the worktree or `cp -R` without node_modules + `bun install`)
   and do it there, from inside your test.
4. Do not add a wait, a reload or a retry that a user would not do. Playwright's auto-waiting
   `expect(...)` with a timeout of a few seconds is OK (a person watching a page waits a few seconds).
5. Do not run `make`, `bun test` or `playwright` on the whole repo's own suites unless a step asks it.

## Where to put tests
- Unit/CLI tests (bun:test): `.werk-heldout/unit/<group>/<ticket>.test.ts`.
  Run: `cd .werk-heldout && CI=true bun test unit/<group>/` (the bunfig.toml in `.werk-heldout/`
  sets the preload `../src/test/preload.ts`, which gives a clean env and the fake agent first on PATH).
  Use the harness `../../../src/test/harness.ts`: `makeProject()` gives a temp git repo with
  `p.werk([...args])` → `{code, stdout, stderr}`, `p.run([...])`, `p.scriptAgent(script)`,
  `p.agentLaunches()`, `p.agentInputs()`, `p.agentRoles()`; `serveProject(p)` starts `werk serve`.
  The fake agent is `src/test/fake-agent.ts` (read its header for the script format: steps of
  event/edit/ask/sleep/waitFor/crash, roles keyed by WERK_AGENT_ROLE, lists of replies per role).
  Existing tests in `src/**/**.test.ts` show how the product is driven — read them for idioms, but
  write your own tests from the step text.
- Browser tests (Playwright): `.werk-heldout/e2e/<group>/<ticket>.spec.ts`, import
  `{ test, expect } from '../../../e2e/harness.ts'` (fixture `werk`: `url`, `dir`, `cli(args)`,
  `start(args)`, `scriptAgent`, `agentLaunches`; it serves a copy of `e2e/fixture-project`). You may
  write your own fixture under `.werk-heldout/` if a step needs a different project (e.g. copy the
  harness idea and use a log you write). Run:
  `cd .werk-heldout && CI=true bunx playwright test -c playwright.config.ts e2e/<group>/ --output test-results/<group>`.
- Name each test with its step id first, e.g. `test('107.1 A valid ticket set passes ...', ...)`.

## Results
Classify each step:
- "pass": the test ran and every Then/And/But check held.
- "fail": the product does not do what the step says (the test ran; a check failed, or a feature/verb/
  control the step names does not exist in the product). Give the observed output.
- "binder-error": you could not write a working test (say why).
"Not found" can be your error or a missing feature: say which you think it is in the detail.

Your final message must be ONLY a JSON array, one object per step of your group, every step included:
[{"id": "<step id>", "result": "pass" | "fail" | "binder-error", "detail": "<what the test did and what it saw, 1-3 sentences>"}]
