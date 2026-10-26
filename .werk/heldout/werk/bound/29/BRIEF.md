# Binder brief (shared by every group)

You bind held-out Given/When/Then steps to tests. You run headless. Do not ask questions.

Repository (merged product): /private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-heldout-wt-6Q7XVP
Work only inside `.werk-heldout/<group>/` of that repository (your group name is given in your prompt).

## Hard rules

1. Never change the text of a step. Map it to actions and checks only.
2. Do not make a test pass. When a test fails, record the failure and move on. Fix only your own errors (wrong name, typo, wrong flag in your test).
3. Never change, create or delete a file outside `.werk-heldout/` of the repository (temporary folders under the system temp dir are fine). No git commit, no `make fix`, no `bun install`, no edit of the product. Other agents work in the same checkout at the same time.
4. Do not add a wait, a reload or a retry that a user would not do. Playwright auto-waiting assertions (`await expect(locator).toBeVisible()`, `expect.poll` for "appears without reload") are fine: they observe, they do not act.
5. Never touch a real `.werk` store of a real project. Every test uses a temporary project.
6. Do not run `make test`, `make check`, `make e2e`, `make test-coverage` or `bun test` with no path inside the checkout: they would pick up other agents' files. If a step needs `make ...` on the whole repository, make a copy first, for example: `T=$(mktemp -d); git -C <repo> archive HEAD | tar -x -C $T; ln -s <repo>/node_modules $T/node_modules`. The Makefile reinstalls only when `node_modules/.werk-installed` is older than `package.json`/`bun.lock`; check that the copy's files do not look newer (use `touch -r <repo>/package.json $T/package.json $T/bun.lock` or `touch -d` an old date), so make does not run `bun install` into the shared node_modules. Run make in `$T`. Keep the test code that drives this under `.werk-heldout/<group>/`.

## How to run tests

- Unit/CLI tests: files `*.test.ts` under `.werk-heldout/<group>/`. Run from the repo root: `bun test ./.werk-heldout/<group>/` (the repo `bunfig.toml` preload puts the fake agent first on PATH and cleans the env). If bun skips the dot folder, pass the file paths explicitly.
- Browser tests: files `*.e2e.ts` under `.werk-heldout/<group>/`. Run: `bunx playwright test --project=heldout .werk-heldout/<group>/ --output .werk-heldout/<group>/pw-out --workers=2`. ALWAYS pass `--output` inside your group folder.
- The CLI is `bun src/cli.ts <verb>` (run `bun src/cli.ts help`). The map store is `<project>/.werk/log.jsonl`.

## Harnesses to read and reuse (import them; do not edit them)

- `src/test/project.ts` (`freshProject`: temp git project, `werk([...])`, fake agent script, launches), `src/test/fake-script.ts`, `src/test/fake-bin/`.
- `e2e/project.ts` (`project()`/`stop()`: temp project with a #root card and a real server; `seed()` writes log events) and `e2e/harness.ts` (`Harness`, `test` fixture: server on a copy of `e2e/fixtures/project`, `copy`/`hot` options, restart).
- Existing product tests show selectors, flags and event types: `src/verbs/*.test.ts`, `src/map/*.test.ts`, `src/serve/*.test.ts`, `src/tickets/*.test.ts`, `e2e/*.e2e.ts`. Read the matching ones first.

## Result per step

- "pass": the product does what the step says.
- "fail": the product does not do what the step says (say what you saw).
- "binder-error": you could not write a working test for the step.
  "Not found" can be your error or a missing feature: say which one you believe, and why.

## Your final answer

Only a JSON array, one object per step of your group, every step included:
[{"id": "<step id>", "result": "pass" | "fail" | "binder-error", "detail": "<what the test did and what it saw, 1-3 short sentences, plus the test file name>"}]
If the brief left something open, put the reading you chose inside the detail.
