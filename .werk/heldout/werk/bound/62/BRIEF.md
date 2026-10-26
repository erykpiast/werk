# Binder brief (shared by every binder agent)

You bind held-out Given/When/Then steps to tests for the werk product in this checkout:
/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-heldout-wt-B3Q10E

## Hard rules
1. Never change the text of a step. Map it to actions and checks only.
2. Do not make a test pass. When a check fails, record the failure and move on. Fix only your own
   errors (wrong name, typo, wrong selector, wrong flag name that `help` shows differently).
3. Write files ONLY under `.werk-heldout/<your-group>/`. Changing any file outside `.werk-heldout/`
   voids the whole report. No git commit, no git stash, no edits to src/, web/, e2e/, scripts/.
   You may IMPORT helpers from e2e/ and src/test/ (read-only use).
4. No wait, reload or retry that a user would not do. (Playwright's auto-waiting `expect` is fine;
   a page.reload() where the step says "without a reload" is not.)
5. Do not run `make test`/`bun test` over the whole checkout: other binders write tests in parallel.
   Run only your own files.
6. "Not found" can be your error or a missing feature. Say which one you think it is.

## What the product is
- CLI: `bun src/cli.ts <verb>`; `bun src/cli.ts help` lists verbs (accept, add, discard, edit, find,
  help, inbox, kill, link, propose, quote, rederive, remove, removed, reopen, restore, say, search,
  serve, show, stale, status, ticket-check, unlink). The "werk" in a step = this command line.
- The map log is `.werk/log.jsonl` in the project folder (found from cwd), one JSON event per line:
  `{"seq":N,"at":"...","actor":"you"|"agent","type":"node.added"|"node.proposed"|"change.accepted"|...,"payload":{...}}`.
  Event types are in src/map/types.ts. `ROOT_ID` is "root" (show with no id opens #root).
- A "Given" state may be seeded by appending events directly to the log (e.g. a real decided card:
  `node.added` with payload `{id, kind:"card", title, why, body, parent?, status:"decided"}` or a
  `node.added` then `node.decided`). Use the real CLI for every "When" step.
- `add` creates a ghost (`node.proposed`); `accept <id> --actor you` accepts; `discard` drops a ghost.

## Test stacks
- Unit/CLI tests: Bun test. Files `*.test.ts`. Run from the checkout root so bunfig.toml preloads
  apply: `bun test --timeout=60000 .werk-heldout/<group>/`. Harness: `freshProject()` in
  src/test/project.ts (a temp git project with an empty `.werk/log.jsonl`; `p.werk([...])` runs the CLI
  and returns {code,out,err}; removed after each test).
- Browser tests: Playwright. Files `*.e2e.ts`. Config has a project "heldout" with testDir
  `.werk-heldout`. Run: `bunx playwright test --project heldout .werk-heldout/<group>/`.
  Harnesses: e2e/project.ts (`project(script, before)` gives {dir,url,werk,seed}; call `stop` in
  afterEach) and e2e/harness.ts (`test` fixture with `harness.start({copy,hot})`, restart, stop).
  Read the product's own e2e/*.e2e.ts for selectors, but write your own tests from the step text.
- The machine is shared with other binders running at the same time. If a test times out from load
  (not from a product failure), you may rerun the same test command once; say so in the detail.

## Output
Return ONLY a JSON array, one object per step of your group, every step included:
[{"id":"<step id>","result":"pass"|"fail"|"binder-error","detail":"<what the test did and what it saw>"}]
"fail" = the product does not do what the step says (name the exact check and the observed value).
"binder-error" = you could not write a working test for the step. Keep each detail to 1-3 sentences.
A step passes only if every Then/And/But line of it passes. Name the first failing line in the detail.
