Held-out tests. Run from the checkout root.

- Unit and command line tests: `bun test --timeout=300000 ./.werk-heldout/unit/<file>.test.ts`
- Browser tests: `cd .werk-heldout && bunx playwright test -c playwright.config.ts`
- `unit/gate.test.ts` (step 01.1) runs `make` in a copy of the checkout and takes about 6 minutes.
