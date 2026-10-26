# werk v0

werk v0, built from the decided cards. Nothing here is copied from the prototype.

```bash
bun install
bun run serve            # werk serve, in the current directory
bun run dev              # the same under bun --hot: a server edit reloads in the same process
bun test                 # server tests and React component tests
bun run test:coverage    # the same with coverage, then the 90% gate on tools/pure-files.ts
bun run e2e              # Playwright, against a real server on a copy of e2e/fixtures/demo
```

`werk serve` runs from the project directory: `bun /path/to/v0/src/cli.ts serve --port 4747`.

The map is the fold of `.werk/log.jsonl`, one JSON event per line. `werk add`, `link`,
`retitle`, `edit`, `decide`, `reopen`, `remove`, `restore`, `say` and `dispute` append
events; `werk show [<id>]` prints a card's page. `werk help` lists the flags. In the
browser, `/card/<id>` is the page of one card.

Every test runs with the fake agent in `test/fake-agent/` first on PATH. `test/harness.ts`
makes a temporary project and git repository and runs werk commands against it. Each browser
test saves a PNG to `e2e/evidence/`.
