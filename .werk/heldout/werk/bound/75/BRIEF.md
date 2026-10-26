# Binder brief (shared by every binder agent)

You are a binder of a held-out test set for the werk product in this checkout:
/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-heldout-wt-CsjNvx  (call it CHECKOUT)

You run headless. Do not ask questions. If a step leaves something open, pick a reasonable reading and say so in the detail.

## Task
For each step assigned to you: read the code, find what the step names, write a test for it in the
project's own stack, run it, and record the result. Steps are Given/When/Then scenarios.

## Hard rules (a break voids the whole report)
1. Do not change the text of a step. Only map it to actions and checks.
2. Do not make a test pass. When a test fails because the product does not do what the step says,
   record "fail" and move on. Fix only your own errors (wrong selector, wrong name, typo).
3. Do NOT create, change or delete ANY file outside CHECKOUT/.werk-heldout/. Not src/, not e2e/,
   not package.json, not pure-files.txt, nothing. Do not run `make fix`, `biome --write`, `git stash`,
   `git checkout`, or anything that writes in the checkout. If a step needs the repository edited
   (delete a test file, add a verb module, replace a symlink), make a COPY of the checkout in a temp
   folder (for example `git clone CHECKOUT /tmp/x` or `cp -R`, with node_modules symlinked or
   `bun install --frozen-lockfile` in the copy) and edit the copy only.
4. Do not add a wait, a reload, or a retry that a user would not do. Playwright's normal
   auto-waiting `expect(...)` with a timeout is fine; a manual page.reload() to make data appear is not
   (unless the step says the person reloads).
5. Do not fix the product.

## Stack
- CLI: `bun src/cli.ts <verb> ...` (run `bun src/cli.ts help`). The map is `.werk/log.jsonl` in the
  project folder (cwd). Each line is one JSON event: {seq, at, actor, type, payload}. A test may seed
  the log by appending lines (types such as node.added, node.decided, link.added... — read
  src/map/types.ts and existing tests for exact shapes). Prefer the CLI for the agent's steps.
- Unit tests: bun test. Harness: `src/test/project.ts` (`freshProject()` gives a temp project with a
  git repo, `project.werk([...])` runs the CLI and returns {code,out,err}). The bunfig preload cleans
  env and puts the fake agent (src/test/fake-bin/claude) first on PATH, and removes projects after
  each test. Put your bun tests in `.werk-heldout/<yourprefix>-*.test.ts` and import the harness with a
  relative path like `../src/test/project.ts`. Run with
  `bun test --timeout=60000 ./.werk-heldout/<file>` from CHECKOUT.
- Browser tests: Playwright. `playwright.config.ts` has a project "heldout" whose testDir is
  `.werk-heldout` and testMatch `**/*.e2e.ts`. Name your files `.werk-heldout/<yourprefix>-*.e2e.ts`.
  Harnesses you can import: `../e2e/project.ts` (`project(script, before)` gives a fresh project with a
  #root card "Root" and a running server; `w.werk(...)`, `w.seed(type,payload)`, `stop()` in afterEach)
  and `../e2e/harness.ts` (class Harness: copies the fixture project, `copy`/`hot` options,
  stop/restart). Read existing specs in `e2e/` to learn the page's selectors and data attributes.
  Run ONLY your own files, with your own output folder so parallel binders do not clash:
  `bunx playwright test --project=heldout .werk-heldout/<yourprefix>- --output=/tmp/pw-<yourprefix> --workers=2`
- The fake agent is scripted: read `src/test/fake-script.ts`, `src/test/fake-agent.ts`.
- Several other binders run at the same time in the same checkout. Never touch their files
  (other prefixes). Do not run the whole Playwright suite or the whole bun suite.

## Output
When done, write `.werk-heldout/results/<yourprefix>.json`: a JSON array, one object per assigned step,
every assigned step included:
  {"id": "<step id>", "result": "pass" | "fail" | "binder-error", "detail": "<what the test did and what it saw>"}
"fail" = the product does not do what the step says. "binder-error" = you could not write a working test.
When something is "not found", say in the detail whether you think it is your error or a missing feature.
Keep each detail to 1-3 sentences, concrete (commands/selectors used, the observed output).
Your final reply: only the path of the results file and a one-line tally.
