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

The map is the fold of `.werk/log.jsonl`, one JSON event per line. The command line is the
only write path: `werk add`, `link`, `retitle`, `edit`, `decide`, `reopen`, `status`,
`remove`, `restore`, `say` and `dispute` each append exactly one event and never touch the
lines above it. `werk show [<id>]` prints a card's page. `werk help` lists the flags.

In the browser, `/#<id>` is the page of one card. The server watches the log and sends
`changed` on the live channel (`/api/live`); the open page then fetches `/api/map` again.
The page has links only; nothing in it writes.

Every test runs with the fake agent in `test/fake-agent/` first on PATH. `test/harness.ts`
makes a temporary project and git repository and runs werk commands against it. Each browser
test saves a PNG to `e2e/evidence/`.
