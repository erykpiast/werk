# Working on werk

## Run

- `make` lists every task. Each target checks the pinned Bun version, installs the locked
  packages when they changed, then calls one script in `package.json`.
- `make dev` starts werk in development, with hot reload.
- `make fix` applies the safe lint and format fixes. Run it before the checks.

## Checks

| Check         | Target               |
| ------------- | -------------------- |
| lint          | `make lint`          |
| typecheck     | `make typecheck`     |
| test          | `make test`          |
| test:coverage | `make test-coverage` |
| e2e           | `make e2e`           |

`make check` runs all of them in the order the merge loop runs them.

A new pure file goes into `pure-files.txt` in the change that writes it, with its own test
file beside it: `x.ts` is tested by `x.test.ts`. A merge keeps every entry of that list from
both sides.

## Where code lives

- `src/`: the server and the command line. Bun runs it directly.
- `web/`: the client. Vite transforms it.
- `scripts/`: the tooling of this repository, such as the coverage check and the edit hook.

## Decisions

The werk map is the design documentation. A decision goes on the map as a card, not into
this file. Code comments point at the card that explains them, as `#card-id`.

Before you change code, list the build-rule cards (the card `#how` and every card under it)
and follow every one. Read a rule's card in full when your change touches it.

## The map rules

werk gives the text below to every agent it starts in another project. In this repository,
`{{werk}}` in it is `bun src/cli.ts`, and the subagents it names are in `.claude/agents/`.

@src/agent/instructions.md
