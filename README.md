# werk

A visual layer over Claude Code. The map is the record of what the conversation settled.

```bash
node src/cli.ts serve      # http://localhost:4000
```

Leave the map open in a browser while you talk to Claude Code. Claude appends events to
`.werk/log.jsonl` as decisions are made. The map redraws by itself.

## The one idea

```
events (.werk/log.jsonl, append-only)  →  fold  →  graph {nodes, edges}  →  one view = one node
```

The graph is derived, cached and disposable. The log is the truth. Nothing is deleted:
a removal is an event. That is why "mark stale, never delete" is a property, not a rule.

## The grammar

Four node kinds and four edge types. The grammar stays small so the agent can maintain it
during a live conversation. IBIS survived 50 years on three edge types.

| Node kind | What it is |
| --- | --- |
| `card` | A decision or an open question. `status` tells them apart. |
| `source` | A paper, benchmark, doc or tool. Many cards cite one source. |
| `excerpt` | A quote from a transcript, with a pointer back to it. |
| `option` | An alternative. Kept forever, never deleted. |

| Edge type | Meaning | When the target changes |
| --- | --- | --- |
| `refines` | The level tree. | Children are reviewed, not invalidated. |
| `depends_on` | This card is true only because that card is true. | The reverse closure goes **stale**, all hops. |
| `supported_by` | Evidence. | Flags the citer for review, one hop. |
| `alternative_to` | A rejected option, kept on the decision. | Live again when the card reopens. |

`relates_to` does not exist. You cannot act on it.

## Commands

Run `node src/cli.ts help` for the full list. The ones you use most:

```bash
node src/cli.ts add rubrics --title "Rubrics are per-project files" \
     --why "The machine-checkable exit condition for a stage" \
     --parent loop --status decided --who you
node src/cli.ts link lp-split rubrics --type depends_on --why "The split follows the stage exit conditions the rubrics define"
node src/cli.ts reopen rubrics          # prints every card that just went stale
node src/cli.ts rederive lp-split
node src/cli.ts stale
```

## Every card has an id

The id is the address. It is the URL hash (`http://localhost:4000/#werk-excerpt`), the
badge at the top of the card, and the first item in the meta line of every card below.
Click the badge to copy it.

Say `#werk-excerpt` in Claude Code and the agent knows which card you mean.

## The conversation pane

The pane is docked on the right and never resets. It is one continuous conversation.

As you navigate the map, the chip above the composer names the card your next message
carries. The card travels with the message only when it changed, so navigating costs
nothing and the agent always knows what you are looking at.

The pane runs its own `claude` child process:

```
claude --print --input-format stream-json --output-format stream-json --verbose
```

That is the same mechanism Conductor uses. When the agent runs a `werk` command, the log
changes, the server sees it, and the map redraws while you read the reply.

**What the pane's agent may do.** It maintains the map, reads the repository, and edits
code: `Bash(node src/cli.ts:*)`, `Read`, `Edit`, `Write`, `Grep`, `Glob`, `WebSearch`,
`WebFetch`, under `--permission-mode acceptEdits`. A file edit applies with no prompt,
because the pane has nowhere to show one. Narrow it with:

```bash
node src/cli.ts serve --allow "Bash(node src/cli.ts:*),Read,Grep,Glob"
```

**You see the turn as it happens.** The pane streams the same things Claude Code shows:
thinking, each tool call as its command is typed out, the tool result, then the reply. The
header carries a running indicator — what it is doing, elapsed seconds, and output tokens —
and the turn ends with its duration and cost. Replies render as Markdown: fenced code
blocks, inline code, bold, lists and links. Card bodies render the same way.

**Paste a screenshot.** `Cmd+V` an image into the composer, or drag one onto the pane.
A `[Image #1]` token goes in at the caret and a chip appears above the composer, the way
Claude Code marks the place. Remove a chip and its token goes with it; the rest renumber.

The file lands in `.werk/attachments/`, the agent gets each token mapped to its path, and
opens it with `Read`. PNG, JPEG, GIF and WebP, up to 20 MB.

**A restart continues the conversation.** The child's session id is kept in
`.werk/session`, and `serve` passes it to `--resume`. So editing werk's own code and
restarting the server does not wipe the agent's memory — the transcript on screen and what
the agent remembers stay the same thing. The pane marks each restart with
`Resumed session 1dcacf3e.`

If Claude Code reports `No conversation found with session ID`, werk says so, starts a new
session, and re-sends the message you were waiting on. Any other crash leaves the stored id
alone — losing a working conversation costs more than a retry — shows the child's own error
text, and retries once. Use `serve --new` to start fresh on purpose.

**One server per repository.** `serve` takes `.werk/serve.lock`. A second server would
share the session id and the transcript with the first, which looks exactly like the agent
losing its memory at random, so it refuses to start. To run a second instance on purpose,
point `WERK_LOG` at another directory.

**Two files, two jobs.** `.werk/chat.jsonl` is the transcript and is gitignored and
disposable, along with `.werk/session`, `.werk/serve.lock` and `.werk/attachments/`.
`.werk/log.jsonl` is the map and is committed. The map is the record of what
the conversation established. The transcript is not.

## Keys in the map

- `/` — jump to a card
- `Backspace` — go up one level
- `Enter` in the chat pane — send. `Shift+Enter` — a new line.
- `Cmd+V` in the composer — attach a screenshot.
- Drag the divider — resize the pane. The width is remembered.

## Status

This is the first version. What works: the log, the fold, staleness over the whole
`depends_on` closure, disputed sources, one view = one node, live reload.

What does not exist yet: editing cards from the map, excerpt pointers into real transcript
files, snapshots, and any tie to the pipeline engine. See `HANDOVER-pipeline-and-decision-map.md`
for the design those parts follow.
