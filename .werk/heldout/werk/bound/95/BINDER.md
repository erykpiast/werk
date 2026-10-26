# Held-out binder notes (shared by all binder agents)

Repo root: the git worktree that holds this folder. werk is a Bun + TypeScript CLI (`src/cli/main.ts`),
server (`src/server`), React web client (`web/`). Event log: `<project>/.werk/log.jsonl`; board log: `.werk/board.jsonl`.
Dependencies are installed (`node_modules/`).

## Unit / CLI tests (bun test)
- Put files at `.werk-heldout/<group>/<name>.test.ts`.
- Use the project's harness: `import { makeProject, serveProject, scriptRunAgent } from '../../src/test/harness.ts'`.
  `makeProject()` gives a temp git repo (one empty commit, empty map) with the fake agent `claude` first on PATH;
  `p.werk([...args])` runs the CLI and returns `{code, stdout, stderr}`; `p.scriptAgent(script)` scripts the fake
  agent (see `src/test/fake-agent.ts` header for the script format, roles via WERK_AGENT_ROLE).
- Run from the repo root: `CI=true bun test ./.werk-heldout/<group>/` (the preload in bunfig.toml applies).
- Look at existing tests in `src/cli/*.test.ts`, `src/map/*.test.ts`, `src/build/*.test.ts` for how verbs are called.
  `bun src/cli/main.ts help` lists verbs; read `src/cli/verbs/<verb>.ts` for flags.

## Browser tests (Playwright)
- Put files at `.werk-heldout/<group>/<name>.spec.ts`, import `{ expect, test } from '../../e2e/harness.ts'`.
  The `werk` fixture gives `{url, dir, cli, start, scriptAgent}` on a copy of `e2e/fixture-project`.
  See `e2e/map.spec.ts`, `e2e/board.spec.ts`, `e2e/reflink.spec.ts` for selectors.
- Run: `CI=true bunx playwright test -c .werk-heldout/playwright.config.ts .werk-heldout/<group>/`

## Hard rules
1. Never edit, create, or delete any file outside `.werk-heldout/`. Temp dirs under os.tmpdir() are fine.
   Clone the repo (`git clone <repo root> <tmpdir>`) if a step needs to change project files or run make on a fresh clone.
   Never run `git stash`, `git checkout`, `git commit` or `git reset` in the repo root.
2. You may not change the step text. Map each step to actions and checks only.
3. Do not make a test pass. When a test fails because the product does not do what the step says, record "fail".
   Fix only your own errors (wrong verb name, wrong flag, typo). Do not add waits/reloads/retries a user would not do.
   Playwright's normal auto-waiting `expect(...)` is fine.
4. Name each test with its step id first, e.g. `test('62.1 ...', ...)`. One test per step.
5. "Not found" may be your error or a missing feature: investigate the code, then say which.
6. Do not touch other groups' folders under `.werk-heldout/`; other agents work there at the same time.
