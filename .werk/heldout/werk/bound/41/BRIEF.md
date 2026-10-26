# Binder brief (shared)

Checkout root: the cwd (a git worktree of werk, already `bun install`ed, Bun 1.4.1). Read AGENTS.md and src/agent/instructions.md for context.

Task: for each assigned step (Given/When/Then), read the code, find what the step names, and write a test for it in the project's own stack. Put every test file under `.werk-heldout/` ONLY. Run them. Report one JSON object per step.

HARD RULES
1. Do not change the text of a step. Only map it to actions and checks.
2. Do not make a test pass. If the product does not do what the step says, the result is "fail"; record what you saw. Fix only YOUR errors (wrong name, typo, wrong flag). Do NOT edit any file outside `.werk-heldout/` (a change voids everything). Do NOT add a wait, reload or retry that a real user would not do (Playwright auto-waiting / expect.poll up to a few seconds for a live update is fine when the step says "within a few seconds" or "without a reload"; do not add reloads).
3. Steps that must edit repo files (delete a test, replace a symlink, run `make build`, edit app code, remove tests, etc.) must run on a COPY of the checkout made in a fresh temp dir (e.g. `cp -R` excluding node_modules/.git/dist/test-results, then symlink node_modules, or `git worktree`-free copy). Never modify the checkout itself. Do not delete or modify files outside .werk-heldout/ and temp dirs.
4. "Not found" may be your error or a missing feature; say which you think it is in the detail. result is "binder-error" only if you could not write a working test for the step; "fail" if the product contradicts the step; "pass" otherwise.
5. Use only your assigned file names (prefix given in your prompt) so parallel agents do not collide. Other agents work in the same checkout at the same time: never run `git stash`, `git checkout`, `git clean`, or anything that touches other files. Do not run `make fix` or formatters outside your files.

TOOLS ALREADY VERIFIED
- CLI tests (bun test): file name must contain `.test.` e.g. `.werk-heldout/g1-xxx.test.ts`; run with `bun test ./.werk-heldout/g1-xxx.test.ts` (note the `./`). Use the harness `freshProject()` from `../src/test/project.ts`: `p.werk([...args])` returns {code,out,err}; `p.dir` is the project dir with `.werk/log.jsonl`; `p.script({roles:{...}})` installs the fake agent script (see src/test/fake-script.ts), `p.launches()`. The fake `claude` is first on PATH via the preload (bunfig.toml). Read src/test/project.ts, src/test/fake-script.ts, src/test/fake-agent.ts and existing product tests (e.g. src/verbs/*.test.ts) for usage. The log is `.werk/log.jsonl` (one JSON event per line, fields seq/at/actor/type/payload); you can append raw events to seed a map, as e2e/project.ts `seed` does. Use `bun src/cli.ts help` to see all verbs.
- Browser tests (Playwright, Chromium works): file name `*.e2e.ts` in `.werk-heldout/`; run `bunx playwright test --project=heldout .werk-heldout/g1-xxx.e2e.ts`. Import `test` from `../e2e/harness.ts` (Harness: `harness.start({copy?,hot?})` starts `werk serve` on a copy of e2e/fixtures/project; gives {dir,url,werk(...),stop(),restart(),...}) or `project()`/`stop()` from `../e2e/project.ts` (fresh project with a #root card, scripted fake agent via `project(script, before)`). Read e2e/*.e2e.ts for how existing specs drive the page, the write token, chat, etc.
- Unit-ish helpers exist in src/test/*.ts.

OUTPUT: your final message must be ONLY a JSON array: [{"id":"<step id>","result":"pass"|"fail"|"binder-error","detail":"<what the test did and what it saw>"}], one per assigned step, every step included. Keep detail to 1-3 sentences. If something is left open, pick a reasonable reading and note it in the detail.
