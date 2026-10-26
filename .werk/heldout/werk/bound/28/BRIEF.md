# Binder brief (shared by every binder agent)

You bind held-out Given/When/Then steps to tests for the werk product in this checkout:
CHECKOUT=/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-heldout-wt-XzbXDS
The step texts are in $CHECKOUT/.werk-heldout/steps.md (one `### <id>` section per step). You get a list of ids.

## Hard rules
1. Never change the text of a step. Map each Given/When/Then line to actions and checks.
2. Do not make a test pass. When the product does not do what a line says, the test fails: record it and move on.
   Fix only your own errors (wrong selector, wrong flag name, typo). Read the product code to find the real names.
3. Do NOT change, create or delete any file outside `$CHECKOUT/.werk-heldout/`. Not src, not web, not e2e, not
   pure-files.txt, not test-results. A change there voids the whole report. If a step needs to edit/delete repo files
   (e.g. delete a test, run make), make a throwaway copy first: `git clone -q $CHECKOUT /tmp/xyz` (or a cp into a
   mktemp dir) and work there; symlink or `bun install --frozen-lockfile` the node_modules there.
4. No wait, reload or retry that a user would not do. Playwright auto-waiting expect(...) with a sane timeout is fine.
5. Put your tests in `$CHECKOUT/.werk-heldout/<your-group>/`. Do not touch other groups' folders.
6. Never use AskUserQuestion. You run headless.

## Stack and helpers (already installed; node_modules present)
- werk CLI: `bun src/cli.ts <verb>`; `bun src/cli.ts help` lists verbs/flags. The map log is `<project>/.werk/log.jsonl`
  (JSONL events with seq, at, actor, type, payload). A real (accepted) card can be seeded by appending a
  `node.added` event, or by `add` then `accept <id> --actor you`. Statuses: `status <id> decided` runs a contract check
  (who, depends_on basis, option, kill criterion) - read src/map/contract.ts and src/verbs/*.test.ts to learn how
  existing tests seed decided cards (often by writing events directly).
- Unit/CLI tests: Bun test. Import `freshProject` from `../../src/test/project.ts` (gives a temp git project with an
  empty `.werk/log.jsonl`, `project.werk(args)` -> {code,out,err}, `project.script(...)` for the fake agent,
  `project.launches()`). Run: `cd $CHECKOUT && bun test ./.werk-heldout/<group>/` (the bunfig preload applies).
  Look at src/verbs/*.test.ts for patterns.
- Browser tests: Playwright, file name `*.e2e.ts`. Import `{ test, FAKE_BIN, appFile }` from `../../e2e/harness` and
  `expect` from `@playwright/test`. `const w = await harness.start()` starts a real server on a copy of the
  fixture project e2e/fixtures/project (w.dir, w.url, w.werk(...args) runs the CLI, w.restart(), w.stop()).
  To get your own map, write `${w.dir}/.werk/log.jsonl` (then restart, or rely on the live watch), or use w.werk.
  Look at e2e/*.e2e.ts for patterns (selectors, how the page renders cards, the chat pane, the fake agent).
  Run: `cd $CHECKOUT && npx playwright test --project=heldout --workers=2 .werk-heldout/<group>/`
- Fake agent: src/test/fake-agent.ts, src/test/fake-script.ts, src/test/fake-bin/claude. The tests never reach a
  real `claude`.

## Output
Return ONLY a JSON array, one object per step id you were given, every id included:
[{"id": "<step id>", "result": "pass" | "fail" | "binder-error", "detail": "<what the test did and what it saw>"}]
"fail" = the product does not do what the step says (quote the failing line and what was seen).
"binder-error" = you could not write a working test for the step. When something is "not found", say in the detail
whether you think it is your error or a missing feature. A step passes only if every line of it passed.
Keep each detail to 1-3 sentences.
