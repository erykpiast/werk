# Binder brief (shared by all binder agents)

You write held-out tests for steps of user paths (Given/When/Then), against this checkout (the merged werk product).
Working dir: /private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-heldout-wt-HC1lqH . Do not cd elsewhere.

## Hard rules
1. NEVER change, create or delete any file outside `.werk-heldout/` (node_modules is already installed; do not reinstall). A change voids the whole report. For tests that need to edit the app or delete files, work on a COPY in a temp dir (e.g. `copyApp()` from src/test-env/app-copy.ts, or `cp -R` of the repo without node_modules + symlink node_modules). Build outputs (release builds, coverage dirs) go to a temp dir, never into the checkout (`dist/`, `coverage/`, `test-results/` must not appear in the checkout: if a tool writes there, point it elsewhere or delete only what you created and check `git status --short` shows only `.werk-heldout/`).
2. You cannot change the text of a step. Map each step to actions and checks (one test per step, name it with the step id, e.g. `test("05.1 ...")`).
3. Do not make a test pass. When a test fails because the product does not do the step, record the failure and move on. Fix only your own errors (wrong name, typo, wrong flag). Do not add a wait, reload or retry a user would not do (polling for an async UI/live update with a timeout is fine only where the step says "without reload"/"live"; keep it short).
4. "Not found" may be your error (wrong verb/flag/route name: read the code with grep first) or a missing feature. Say which in the detail.
5. Result values: "pass" | "fail" (product does not do what the step says) | "binder-error" (you could not write a working test) | "unbuilt" (the product lacks a capability that is the job of one of these NOT-YET-MERGED tickets; put its id in "owner"; if the missing capability is the job of the step's own ticket or of none of these, answer "fail"):
 - werk/36: Every build closes its card obligation, and a missing decision becomes a proposed card instead of a stuck ticket
 - werk/38: The merge loop builds a subtree's tickets and merges each one onto the main line on green checks
 - werk/39: Up to three tickets build at once when they touch no module in common
 - werk/40: The held-out set is written beside each build, bound to browser tests, and gates G2 on the run's tree
 - werk/41: After each merge the held-out set runs beside the queue and files one follow-up per broken ticket
 - werk/45: A person reorders, archives and triggers tickets on the board
 - werk/46: One Build press on a decided card plans and runs its subtree, and a plan card shows its progress
 - werk/47: A done ticket shows a red badge for a broken held-out step and a grey one for a step that did not run

## Stack / helpers (read them first)
- Unit-ish tests: Bun test. `src/test-env/project.ts` `createProject()` / `useProject()` gives a temp git project with `.werk/log.jsonl`, `run([...])` (clean env, fake agent first on PATH, WERK_HOME temp), `events()`, `install(script)`, `launches()`. CLI: `bun src/cli.ts <verb> ...` (absolute path to src/cli.ts). Existing tests (src/cli/cli.test.ts, src/**/*.test.ts) show verb usage — read them to learn flags, but write your OWN tests under .werk-heldout/. Run with `bun test ./.werk-heldout/<file>.test.ts` (the `./` is required; bunfig preloads the test env). Use `CI=true`.
- Fake agent: fake/claude, scripts in src/fake-agent/script.ts, env WERK_FAKE_SCRIPT, WERK_AGENT_ROLE.
- Browser tests: Playwright (chromium installed). `e2e/support/server.ts` `startBrowserServer()` runs a real werk server on a copy of e2e/fixtures/project (supports `appCopy: true` and `script`). Import helpers from ../e2e/support/*.ts. Put specs in `.werk-heldout/<name>.spec.ts` and run with your own config: create `.werk-heldout/playwright.config.ts` (testDir '.', testMatch '**/*.spec.ts', outputDir in os tmpdir, `use: {browserName:'chromium'}`) — if the file exists already, use it, do not edit it; if you need a custom one name it `playwright.<group>.config.ts`. Run: `bunx playwright test -c .werk-heldout/<config> <file>`. Do NOT run `playwright install`.
- Never reach real external services or the real `claude`; every server uses the fake agent.
- Make targets: `make test` etc. exist (`make` lists them). Bun version is pinned and matches.
- Other agents work concurrently in other files of `.werk-heldout/`. Use only your own filename prefix (given below). Do not edit others' files.
- Read the map cards / docs if useful: `bun src/cli.ts show <id>` in the checkout shows cards of the project's own map (.werk/log.jsonl) — e.g. `bun src/cli.ts search <term>`; the code comments cite card ids like #werk-test-gate-list.

## Output
Write your results to `.werk-heldout/results/<prefix>.json` as a JSON array and ALSO return it as your final answer: one object per step: `{"id":"05.1","result":"pass|fail|binder-error|unbuilt","detail":"<what the test did and what it saw, 1-3 sentences, include the failing message/exit code for fails>","owner":"<werk/NN only for unbuilt>"}`. Every assigned step must be included. Be honest: a pass means your test ran the steps and every Then/And check held. Before finishing, run `git status --short` and confirm only `.werk-heldout/` changed.
