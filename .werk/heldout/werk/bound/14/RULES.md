# Held-out binder rules (read fully)

You bind Given/When/Then steps to tests in this repo (werk: a Bun + React decision-map tool).
Repo root = the current working directory. Dependencies are installed. Bun 1.4.1.

HARD RULES
1. Write files ONLY under `.werk-heldout/<your-area>/`. Never edit, create or delete any other file
   in the checkout (not src/, e2e/, scripts/, pure-files.txt, .claude/, nothing). A change outside
   `.werk-heldout/` voids the whole report. If a step needs a file changed (e.g. delete a test file,
   replace a symlink, edit server code), copy the repo/app into a temp dir (os.tmpdir) and change the copy.
2. You cannot change the text of a step. Map each step to actions and checks only.
3. Never make a test pass. When a check fails, record the failure and move on. Fix only your own
   errors (wrong selector name, typo, wrong flag you misread). Do not add a wait, a reload or a retry
   that a user would not do. Playwright's normal auto-waiting `expect(...).toHaveText` etc. is fine.
4. Do not create git commits, do not stash. Do not ask questions; pick a reasonable reading and say so.

HOW TO RUN
- Unit/CLI tests: file names `*.test.ts`. Bun skips dot-folders when discovering, so pass explicit
  paths: `bun test --timeout=60000 ./.werk-heldout/<area>/x.test.ts`. The repo bunfig preload applies.
- Browser tests: file names `*.e2e.ts`; run
  `bunx playwright test -c .werk-heldout/playwright.config.ts <area>/` (config exists; testDir is .werk-heldout).
- Helpers you MAY import (read-only): `src/test/project.ts` (`freshProject()` → temp project with empty
  `.werk/log.jsonl`, `werk(args)` returns {code,out,err}, `start()` spawns), `e2e/project.ts`
  (`project(script, before)` → temp project with a #root card + a running `werk serve`; `seed(type,payload)`
  appends a raw log event; `werk(...)` throws on non-zero exit; `stop()` in afterEach), `e2e/harness.ts`
  (Harness with copy/hot/restart options). Existing tests in `src/**/*.test.ts` and `e2e/*.e2e.ts`
  show selectors and patterns. Reading them is encouraged, but write your own tests.
- `bun src/cli.ts help` lists every verb and flag. The log event shapes are in `src/map/types.ts`.
  Given-steps (setup state) may be built by appending raw events to `.werk/log.jsonl` (see
  `src/verbs/search-verbs.test.ts` withMap) or by CLI calls. When/Then steps must use the real
  user path the step names (CLI command, browser page, HTTP request).
- "real card" = accepted or `node.added`; "ghost" = `node.proposed` not yet accepted.
  A "decided" card in a Given may come from raw `node.added` with status decided.

OUTPUT
Return ONLY a JSON array, one object per step id assigned to you:
[{"id":"<step id>","result":"pass"|"fail"|"binder-error","detail":"<what the test did and saw>"}]
"fail" = the product does not do what the step says (quote the observed output briefly).
"binder-error" = you could not write a working test (explain). When something is "not found",
say whether you think it is your error or a missing feature. A scenario with many Then lines is one
step id: it passes only if every line holds; for a fail, name the first line that failed and what
was seen. If you had to pick a reading of an ambiguous line, say so in the detail.
