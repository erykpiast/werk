# Held-out binder brief (shared by all binder agents)

Repo root (the merged product): /private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-heldout-wt-nMH4XA
You are a binder of a held-out test set. Headless: never ask questions.

## Hard rules

1. NEVER change any file outside `.werk-heldout/`. Not src, not web, not e2e, not scripts, not package.json, not pure-files.txt, not git state (no commits, no stash, no checkout, no reset). A change outside voids the whole report. Scratch work also goes under your own folder `.werk-heldout/<group>/` (writes to /tmp are denied). When a step needs to edit/delete a repo file (e.g. delete a test file, edit the Makefile), do it in a COPY of the repo made under your own folder, never in the checkout.
2. You cannot change the text of a step. You map it to actions and checks only.
3. You do not make a test pass. When a test fails because the product does not do what the step says, record the failure and move on. Fix only your own errors (wrong name, wrong selector, typo, a CLI flag that you misread). Do not add waits, reloads or retries that a user would not do. (Playwright's normal auto-waiting `expect(...)` with default timeouts is fine.)
4. "Not found" can be your error or a missing feature: read the code to decide, and say which.

## Stack

- CLI/unit-level steps: Bun test. File names `*.test.ts` under `.werk-heldout/<group>/`. Use the harness `freshProject()` from `src/test/project.ts` (import with a relative path, e.g. `../../src/test/project.ts`): `const p = freshProject(); const r = await p.werk(["add","x","--title","X"]);` gives `{code,out,err}`; the map log is `join(p.dir, ".werk", "log.jsonl")` (JSON lines: `{seq,at,actor,type,payload}`). You may seed events directly by appending lines to the log (see `e2e/project.ts` `seed`, e.g. `node.added` with `{id,kind:"card",title,parent,status,who}`, `node.decided`) when a Given says a card already exists / is real / is decided; but a step that says "the agent adds/runs X" must run the real CLI.
  Run: `bun test .werk-heldout/<group>/` from the repo root (the bunfig preload applies). Use `--timeout=60000` if needed.
  The CLI: `bun src/cli.ts help` prints every verb. Accept needs `--actor you`. A ghost shows `proposed` in `werk show` output; a held link shows `(held)`.
- Browser steps: Playwright. File names `*.e2e.ts` under `.werk-heldout/<group>/`. The config has a project named `heldout` with testDir `.werk-heldout`. Reuse the harness of the product specs: `e2e/project.ts` (`project(script?, before?)` gives a fresh project with a `#root` card and a running `werk serve`; call `stop` in afterEach; `w.werk(...)`, `w.seed(type,payload)`, `w.url`) or `e2e/harness.ts` (class Harness with a fixture project, restart, hot reload, copy of the app). Read the existing specs in `e2e/*.e2e.ts` for selectors and patterns (e.g. `[data-field="body"]`, `article[data-pending]`, the Accept button).
  Run: `bunx playwright test --project heldout .werk-heldout/<group>/ --output .werk-heldout/<group>/results --workers 2` from the repo root. ALWAYS pass your own `--output` folder, because other agents run Playwright at the same time.
- Read the code (`src/verbs/*.ts`, `src/map/*.ts`, `src/serve/*.ts`, `web/*.tsx`) to map each step's words to the real verbs, flags, selectors and output.

## Output

When done, reply with ONLY a JSON array, one object per step assigned to you, every assigned step included:
[{"id": "<step id>", "result": "pass" | "fail" | "binder-error", "detail": "<what the test did and what it saw; for a fail, the exact failing check and the actual value; say whether a not-found is your error or a missing feature>"}]
"fail" = the product does not do what the step says. "binder-error" = you could not write a working test for the step.
A step passes only if every Then/And/But line of it passes. Write one test per step (named with the step id), so each step gets its own verdict.
