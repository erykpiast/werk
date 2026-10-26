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

The map is the fold of `.werk/log.jsonl`, one JSON event per line. `werk add`, `accept`,
`discard`, `link`, `retitle`, `edit`, `kill`, `decide`, `reopen`, `status`, `remove`,
`restore`, `say` and `dispute` each append exactly one event and never touch the lines above
it. The ✓ in the page is the one write from the browser.

`werk add` proposes: it prints `proposed` and appends a `proposed` event, for every kind
(card, option, source, excerpt). The new node is a ghost. The page draws it grey and dashed
under its proposed parent, and it is outside every derivation: its edges are held, and no
mark, contract fact or count reads them for a real card. The words of a ghost are frozen: a
second `add` with its id, `retitle` and `edit --body|--why|--why-not` refuse. `link`,
`status`, `kill` and `edit --who|--no-basis|--unchallenged` still work, and `decide` checks a
ghost over its held edges, so a ghost can be proposed already decided.

The ✓ on a ghost (`POST /api/accept` with `{"id": "..."}`, with the same origin and content
type rules as a chat turn) appends one `accepted` event. The accept also makes real the
ghost's ghost refines parents up to the first real card, and its own ghost options and
evidence; a held edge goes live once both ends are real, with no event of its own. `werk
accept <id>` refuses unless `--actor you` states that the person asked for it. `werk discard
<id>` drops a ghost, the ghosts below it and their ghost options; the id can then be proposed
again.

`werk decide` (and `werk status <id> decided`) runs the decide contract first: who decides,
a basis or a recorded `--no-basis` reason, an option or a recorded `--unchallenged` reason
for a `you` card, and a kill criterion. A missing fact appends nothing; the command exits 1
and prints, for each missing fact, the one command that supplies it. A change to a decided
card runs the same facts again.

`werk show [<id>]` prints a card's page. `werk help` lists the flags.

A reopen carries a reason. `rejected` marks the next hop stale, in red. `postponed` marks
every card downstream paused, in grey, and deciding the card again clears those marks. Stale
wins on a card that both reach. `werk stale [<id>]` lists every marked card, basis first,
with the trace of each mark; the root page in the browser lists the same.

In the browser, `/#<id>` is the page of one card. The server watches the log and sends
`changed` on the live channel (`/api/live`); the open page then fetches `/api/map` again.
Apart from the ✓ on a ghost, the page has links only.

Every test runs with the fake agent in `test/fake-agent/` first on PATH. `test/harness.ts`
makes a temporary project and git repository and runs werk commands against it. Each browser
test saves a PNG to `e2e/evidence/`.
