# werk — instructions for the agent

This repository builds its own design tool. Use the tool while you build it.

The instructions for any project that werk works on live in one file. werk adds that file to
the system prompt of every agent it starts that can write to the map — see
#agents-instructions. Here, inside werk's own repository, it is imported:

@prompts/agent.md

Read `prompts/agent.md` before writing or changing cards, even if your agent does not
expand imports. It defines how to frame a decision and choose its parent (see #map-wording).

## Run it

```bash
node src/cli.ts serve     # the map and the chat pane, live
node src/cli.ts stale     # what is stale, and what needs an evidence review
```

Bun runs the TypeScript directly. There is no build step and no dependencies. `npm run dev`
hot-reloads a change under src/ without restarting the process or losing a live agent
session — see #werk-hmr.

## Build rules

The rules for how this project is built are the cards under #how in the map. Before you
change code, list them with `werk search --under how` and follow every one. When your task
touches a rule, read its card in full with `werk show <id>`.
