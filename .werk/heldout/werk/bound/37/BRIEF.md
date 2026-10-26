# Shared brief for held-out test writers

Checkout: the cwd (a git worktree of werk, merged product). Deps are installed (bun 1.4.1). Do NOT run `cd` elsewhere.
Goal: for each Given/When/Then step given to you, read the code, write a test in the project's own stack, put it under `.werk-heldout/<your-area>/`, run it, report.

Stack: Bun test (unit/CLI/integration; use helpers in src/test-env/project.ts `createProject`, fake agent in fake/claude + src/fake-agent/*, cleanEnv in src/test-env/env.ts) and Playwright (browser; see e2e/support/server.ts + fixtures.ts, playwright.config.ts). Read AGENTS.md, the Makefile, bunfig.toml (preload sets up env) and existing tests for the idiom.
Run bun tests: `bun test .werk-heldout/<area>/` (pass explicit path; bunfig preload applies). Playwright: write your own config `.werk-heldout/<area>/playwright.config.ts` (testDir this folder, testMatch *.spec.ts, outputDir under /tmp, use chromium) and run `bunx playwright test -c .werk-heldout/<area>/playwright.config.ts`. Chromium is already installed in the playwright cache.

HARD RULES
1. Do not change the text of a step; map it to actions and checks.
2. Never make a test pass. If a test fails because the product does not do it, record failure and move on. Fix only your own mistakes (wrong name, typo, wrong API usage).
3. Do NOT modify any file outside `.werk-heldout/` (no source edits, no config edits). Generated dirs like coverage/ or test-results/ in the checkout must be avoided: run anything that writes into the checkout (make test-coverage, release build) on a temp COPY of the checkout (e.g. `cp -R` without node_modules/.git and symlink node_modules, or `git worktree`-free copy in $TMPDIR), never in place. Playwright outputDir must be in /tmp.
4. Do not add a wait, reload or retry that a real user would not do. Normal Playwright auto-wait/expect polling is fine.
5. Tests run in isolated temp projects/homes (the createProject helper does this); never touch real user data or real services.
6. Do not ask questions. Pick a reasonable reading.

RESULT CLASSIFICATION per step
- "pass": test written and passes.
- "fail": the product does not do what the step says (a capability exists but behaves wrongly, or is absent and is the job of the step's own ticket or no ticket).
- "binder-error": you could not write a working test for the step (say why).
- "unbuilt": the step fails because a capability it reaches the product through is the job of one of these not-yet-merged tickets; owner = ticket id:
  - werk/35: A green pass is graded against its cards and reviewed in five areas before it counts
  - werk/36: Every build closes its card obligation, and a missing decision becomes a proposed card instead of a stuck ticket
  - werk/38: The merge loop builds a subtree's tickets and merges each one onto the main line on green checks
  - werk/39: Up to three tickets build at once when they touch no module in common
  - werk/40: The held-out set is written beside each build, bound to browser tests, and gates G2 on the run's tree
  - werk/41: After each merge the held-out set runs beside the queue and files one follow-up per broken ticket
  - werk/42: The server restarts a build whose process died, as a fresh pass
  - werk/45: A person reorders, archives and triggers tickets on the board
  - werk/46: One Build press on a decided card plans and runs its subtree, and a plan card shows its progress
  - werk/47: A done ticket shows a red badge for a broken held-out step and a grey one for a step that did not run
  If the missing capability is the job of the step's own ticket (or none of the above), answer "fail". "Not found" can be your error (binder-error) or a missing feature — say which you think.

OUTPUT: your final message must be ONLY a JSON array, one object per step assigned to you:
[{"id":"02.1","result":"pass|fail|binder-error|unbuilt","detail":"<what the test did and what it saw>","owner":"<ticket id, unbuilt only>"}]
Keep detail to 1-3 sentences. Name your test file in detail. Include every assigned step.
