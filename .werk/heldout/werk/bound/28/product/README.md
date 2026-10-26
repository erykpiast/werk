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
The dev command, from the project directory, is `bun --hot /path/to/v0/src/cli.ts serve`. It
prints `werk: serving <dir> at http://localhost:<port> (pid <pid>)` once. An edit to a server
module reloads it in the same process, and the output prints:

```
werk: reloaded src/server/app.ts
werk: reusing the live server on port <port> (pid <pid>); not listening again
```

The port, the live channel's clients and the chat agent child stay. A change to the start-up
code itself takes a restart.

`GET /api/health` returns `{ ok, pid, bootId, handlerLoadedAt, host }`. The live channel,
`GET /api/live`, is a server-sent event stream. Its first event, `hello`, carries the state
that survives a reload: `{ pid, bootId, startedAt, children: [{ name, pid }] }`.

`POST /api/chat` with `{"text": "..."}` sends one turn to the chat agent and returns its
`{ pid }`. The agent is a `claude` child in stream-json mode, started in the project
directory on the first turn and reused after that. It is listed in `children` as `chat`. Its
output arrives on the live channel as `agent` events.

The server listens on `127.0.0.1` only, and refuses with 403 any request whose `Host` is not
`localhost:<port>` or `127.0.0.1:<port>`. A chat turn also needs `Content-Type:
application/json` (else 415), and an `Origin`, when present, of `http://localhost:<port>` or
`http://127.0.0.1:<port>` (else 403). A page on another origin cannot start the agent. The fake agent in tests answers each
turn and stays alive until its stdin closes, when no `WERK_FAKE_SCRIPT` is set.

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
