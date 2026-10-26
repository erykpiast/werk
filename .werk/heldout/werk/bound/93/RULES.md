# Rules for every held-out binder agent

Repo root (call it ROOT): /private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-heldout-wt-TGdmzU
Stack: Bun 1.4 (`bun test`), TypeScript, Playwright for the browser. Dependencies are installed.
The CLI is `bun src/cli/main.ts <verb> ...` (verbs in src/cli/verbs/). Map log: `.werk/log.jsonl`. Board log: `.werk/board.jsonl`.

You bind Given/When/Then steps to tests. Rules:
1. Never change the text of a step. Map it to actions and checks only.
2. Do NOT make a test pass. When an assertion fails because the product behaves differently, record it as "fail" and move on.
   Fix only your own errors (wrong flag name, typo, wrong selector you can verify from the source).
3. Do NOT change any file outside ROOT/.werk-heldout/. Not even temporarily. (Running the product in temp dirs is fine.)
4. Do not add a wait, a reload, or a retry that a user would not do. Playwright's auto-waiting `expect(...)` with a
   bounded timeout is fine where the step says "within a few seconds".
5. Read the product source to find what each step names (flags, output text, selectors). Existing tests in src/**/*.test.ts and
   e2e/*.spec.ts show usage; read them, but do not copy their assertions blindly — assert what the STEP says.
6. "Not found" can be your error or a missing feature. Decide which and say so.

CLI tests: put them in ROOT/.werk-heldout/<your-file>.test.ts. You may import the product's harness:
  `import { makeProject } from '../src/test/harness.ts'` — it makes a temp git repo with one empty commit, a fake `claude`
  first on PATH, and `p.werk([...args])` returning {code, stdout, stderr}. See src/test/harness.ts and src/test/fake-agent.ts.
Run from ROOT: `bun test ./.werk-heldout/<your-file>.test.ts` (the leading ./ is required). Use one `test()` per step, named with the step id, e.g. `test('62.1 ...')`.

Browser tests: put them in ROOT/.werk-heldout/e2e/<prefix>-<name>.spec.ts using the shared harness
ROOT/.werk-heldout/e2e/harness.ts (read it). It does not open the page: call `await page.goto(werk.url)` when the person opens the map.
`test.use({ seed: 'fixture' })` copies e2e/fixture-project; default seed 'empty' has no log. `werk.cli(args)` throws on non-zero; `werk.cliRaw(args)` does not.
Run from ROOT: `bunx playwright test -c .werk-heldout/e2e/playwright.<prefix>.config.ts` (config matches files `<prefix>-*.spec.ts`; use only your assigned prefix).
Do not edit harness.ts or the configs; if you need a different harness, write your own file with your prefix.

Final answer: ONLY a JSON array, one object per step assigned to you:
[{"id": "<step id>", "result": "pass" | "fail" | "binder-error", "detail": "<what the test did and what it saw, 1-3 sentences; for fail, quote the observed output>"}]
"fail" = product does not do what the step says. "binder-error" = you could not write a working test for the step.
