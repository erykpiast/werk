# Context

> Entry point for this project's domain language.
> Read this first. It is a map + glossary — not a spec, plan, or scratchpad.

## Format

- **Glossary:** inline below (single-file mode)

## Glossary

- **Contract check** — a hard gate inside `src/cli.ts` itself. It refuses a command when a
  required fact is missing (e.g. `add` with no `--who`, no `depends_on` edge). It must live
  in the CLI, not in a Claude Code hook, because a hook is harness-specific and cannot ship
  with the product (see `#product`, `#pr-logic`).
- **Soft nag** — a reminder, not a gate. It flags that a turn may have settled something
  without a log entry, but never blocks. It belongs in a Claude Code hook, since judging
  "did this turn settle something" needs reading conversation content, which no deterministic
  check can do.
