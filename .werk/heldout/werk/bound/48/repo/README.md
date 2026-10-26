# werk

werk is a visual layer over Claude Code. It keeps a project's decisions in a map: cards
folded from an append-only log. Beside the map, a chat pane lets you talk to a live agent
that writes what the talk settles into the map in the same turn. A ticket board shows the
build of each ticket, from ready to merged.

## Install

werk runs on Bun. The repository pins one Bun version in `.bun-version`, and every task
stops on a different one.

1. Install the pinned Bun version:

   ```sh
   curl -fsSL https://bun.sh/install | bash -s "bun-v$(cat .bun-version)"
   ```

2. Install the Claude Code command line and log in. werk starts it as a child process.

3. Clone this repository. You do not need to install packages by hand. Each make target
   installs the locked packages first.

## Start

```sh
make dev
```

`make` with no target prints every task with a one-line description.
