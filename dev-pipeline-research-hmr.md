# Research: hot reload without losing Agent state (September 2026)

Companion to `dev-pipeline-design.md`. Collected 2026-09-05.

The problem: the agent editing werk's own source is also the agent using it. `node --watch`
restarts the whole process on any change to a watched module. That kills the spawned
`claude` child process (`src/agent.ts`) mid-turn and drops `this.busy`, `this.inflight`,
`this.sessionId`, `this.queue` — every time an edit lands on `src/*.ts`. Eight mid-turn
kills in one session, each within ~200ms of an `Edit` call to `src/cli.ts`, `src/fold.ts`,
or `src/types.ts`, confirm this directly.

The ask: replace full-process restart with true module-level hot reload, so the `Agent`
class's live child-process handle and session map survive an edit to an unrelated module.

## 1. Bun `--hot`

Distinct flag from `--watch`. Per Bun's own docs:

> "Unlike `--watch` mode, Bun doesn't hard-restart the entire process — it detects code
> changes and updates its internal module cache with the new code... global state
> (notably, the `globalThis` object) persists."

Compare `--watch`: "Bun restarts the process with the same CLI arguments and environment
variables as the initial run." [Watch Mode — Bun Docs](https://bun.com/docs/runtime/watch-mode)

What survives, checked directly:

- `globalThis` object identity — explicitly guaranteed.
- Module-level state, closures, and class instances — **not** guaranteed. `--hot` resets
  the internal `require` cache and the ES module registry, then re-evaluates every
  changed module with the JS engine. A module that was not itself edited is not
  re-evaluated, but nothing in Bun's docs promises the object graph across the edited
  boundary stays wired up — an instance held in a non-reloaded module that references a
  class *defined* in a reloaded module faces an `instanceof` mismatch, a known JS hot-reload
  failure mode not addressed in Bun's docs.
- Open sockets, spawned child processes — not addressed by name in Bun's docs. Bun frames
  `--hot` as the fix for "HTTP servers and other stateful objects" being lost under a
  restart-based watcher, which implies the *listening server* is meant to survive, but the
  docs stop short of a child-process guarantee.

Consequence for werk: to keep `this.proc` (the `claude` child handle) alive across a
`--hot` reload, the `Agent` instance must live on `globalThis`, not as a fresh object
constructed at module load. That is testable, not documentable — see recommendation below.

## 2. Vite as a Node backend (middleware mode / `ssrLoadModule` / `vite-node`)

Vite is a bundler with an HMR server built in; running it as a *backend* means using
`server.middlewares` inside your own `http.createServer`, and `ssrLoadModule` (or the
`vite-node` runner that Vitest is built on) to import server code through the same
transform-and-invalidate pipeline used for the client.

**Invalidation is transitive up the import graph, not global.** `vite-node`'s module
cache implements `invalidateDepTree`: on a file change it deletes that module's cache
entry, then recurses into every module recorded as an *importer* of it, walking up to
the entry point — [`vite-node` moduleCache, `invalidateDepTree`
commit](https://github.com/vitest-dev/vitest/commit/b8922aa1954fc6c208ac8ef5698c57774938c323).
Modules **outside** that import chain are never touched and keep their live instances.
This is the one primary source found that gives Bun's guarantee real granularity: if
`Agent` instances are held in a module that `cli.ts` or `fold.ts` do not import, editing
`fold.ts` does not re-execute the `Agent` module, and the child-process handles inside it
are untouched.

**Middleware mode itself has documented restart semantics you must plan around.** Vite's
own SSR guide states that when the dev server restarts (e.g. after a `vite.config.js`
edit), `vite.middlewares` "is still going to be the same reference (with a new internal
stack of Vite and plugin-injected middlewares)" — i.e. the *outer* Node HTTP server
(the one werk would use to hold sockets) is never restarted by Vite; only Vite's internal
pipeline is swapped underneath it. [Vite — Server-Side
Rendering](https://vite.dev/guide/ssr.html)

The general HMR API (`import.meta.hot.accept/dispose/invalidate`) is a client-side
contract for the bundled browser graph, not required for the `vite-node`/SSR path — SSR
invalidation is automatic and transitive, no `accept()` boilerplate needed per module.
[Vite — HMR API](https://vite.dev/guide/api-hmr)

## 3. Deno `--watch-hmr`

Introduced unstable in Deno 1.38 (Nov 2023) as `--unstable-hmr`, stabilized in Deno 1.46
(Aug 2024) as `--watch-hmr`. Deno's own blog:

> "hot-replaces changed modules in the running process instead of restarting it, keeping
> your application's state across edits — and if hot replacement fails, the process falls
> back to a full restart." [Deno 1.46: The Last 1.x Release](https://deno.com/blog/v1.46)

The 1.38 announcement is explicit about the failure boundary: "in some situations it's
not possible to patch the file in-place, such as when changing a top-level symbol or an
async function that is currently running — in such cases the process would do a full
restart." [Deno 1.38: HTML doc generator and HMR](https://deno.com/blog/v1.38)

That is the sharpest statement found on this whole question, from any runtime: **an
in-flight async function is one of the named cases that forces a full restart, not a
patch.** werk's exact failure mode — editing `src/cli.ts` while a `claude` turn is
in-flight inside `agent.ts` — sits close to that boundary. Deno's docs do not promise
which side of the line an edit lands on; only that failure degrades safely to a full
restart rather than a corrupt in-memory state.

Current shorthand: `deno watch main.ts` = `deno run --watch-hmr main.ts`
([Deno docs — watch mode](https://docs.deno.com/runtime/run/watch_mode/)). Deno 2.9 (June
2026) added Node.js 26 compatibility and extended `--hmr` to `deno desktop`
([Deno 2.9](https://deno.com/blog/v2.9)), so the runtime question ("does werk run
unmodified on Deno") is close to settled, but the HMR-survives-in-flight-work question is
not documented either way.

Known caveat: editors that save via a temp-file-then-rename ("atomic save") can detach
`--watch-hmr`'s file watcher on Linux after the first change
([`denoland/deno` #28754](https://github.com/denoland/deno/issues/28754)) — worth
checking against whatever editor/agent tool writes werk's own files, since Claude Code's
`Edit` tool is exactly this kind of external writer.

## 4. Node.js core: no HMR, `--watch` is a full restart

Node's own CLI docs list `--watch`, `--watch-kill-signal`, `--watch-path`, and
`--watch-preserve-output`. The existence of `--watch-kill-signal` — a flag whose only
job is choosing which signal Node sends before restarting — is itself confirmation that
`--watch` operates at the process-restart level, not the module level; there is no
equivalent "which modules to re-evaluate" flag in the option list.
[Node.js CLI docs — `--watch`](https://nodejs.org/api/cli.html#--watch)

Node 26.0.0's changelog carries no HMR entry — its headline changes are cryptography API
consolidation and deprecations, not module reloading.
[Node.js v26.0.0 release notes](https://nodejs.org/en/blog/release/v26.0.0/) Third-party
packages claiming "hot module replacement for Node" (`node-hot-loader`,
`hot-module-replacement` on npm) are Webpack-era tools, last published one to six years
ago — not living projects to build on in 2026.

**Node itself has grown no HMR capability.** Any hot-reload story for werk that keeps
Node as the runtime has to come from outside core: Vite/`vite-node` (§2), or a
supervisor pattern that does not depend on runtime HMR at all (§5).

## 5. The supervisor pattern: is it named, and does it have primary documentation?

No single named pattern in the reviewed sources maps directly onto "a process that owns
child handles and is never restarted by the file watcher, with a thin freely-reloadable
layer reconnecting to it." The closest documented pieces:

- **The Prisma singleton-on-`globalThis` pattern** is the most exact primary-sourced
  precedent found for "a live handle must survive a module being hot-reloaded." Prisma's
  own docs recommend, for exactly this reason:
  ```ts
  const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }
  export const prisma = globalForPrisma.prisma || new PrismaClient()
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
  ```
  "you can store `PrismaClient` as a global variable in development environments only, as
  global variables are not reloaded." [Prisma Documentation — Database
  connections](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections)
  This is the same shape werk needs for the `Agent` instance and its `Map` of sessions —
  attach it to `globalThis` so a module re-evaluation (Bun `--hot`, Vite SSR invalidation)
  finds the existing object instead of constructing a new one.
- **Vite's own middleware-mode guarantee** (§2) — the outer HTTP server reference
  survives a Vite-internal restart — is a primary-sourced instance of "outer process
  never restarted, inner pipeline is."
- **PM2's `watch: true`** is explicitly documented as the wrong tool for this: "the watch
  and restart mode makes hard restart, without sending SIGINT" — i.e. no connection
  draining, no state preservation, by design. PM2's answer to preserving live connections
  is cluster mode with `pm2 reload` (zero-downtime **production** reloads via Node's
  `cluster` module sharing the listening socket across processes), which is a different
  problem (scaling/deploys) from single-process dev-time state preservation.
  [PM2 — Watch & Restart](https://pm2.io/docs/runtime/features/watch-restart/)
- **FD-passing supervisors** (e.g. `catflap`, referenced as designed for `cargo watch`)
  solve the adjacent problem of handing a *listening socket* to a fresh child process
  across a restart, which is a documented, narrower technique than "preserve an
  in-memory session map," and does not help with `child_process` handles specifically.

No primary source was found for "supervisor + thin reloadable layer" as a named pattern
with the shape werk needs (surviving spawned children, not just sockets). This part of
the ask is not settled by documentation — it is closest to what werk would have to build
itself, on top of the `globalThis`-singleton technique Prisma documents.

## Recommendation

Ranked for werk specifically, all evaluated against: does the spawned `claude` child and
`Agent.sessionId`/`queue` state survive an edit to `src/cli.ts` or `src/fold.ts` while a
turn is in-flight.

1. **Top pick: keep Node, put `vite-node` (or Vite in middleware mode) in front of a
   `globalThis`-pinned `Agent` registry.** Reasoning: `vite-node`'s `invalidateDepTree`
   is the only mechanism in this research with a primary-sourced, transitive-not-global
   invalidation model — editing `fold.ts` does not touch a module that never imports it.
   Combine with the Prisma pattern: store the live `Map<sessionId, Agent>` (or the single
   `Agent` instance werk currently has) on `globalThis`, so even if `agent.ts` itself is
   ever re-evaluated, the constructor path finds the existing object instead of replacing
   it. No process restart, no killed child, in the common case of editing a module the
   `Agent` doesn't sit in. **Cost:** this is not "drop in a flag" — it means restructuring
   `src/server.ts`'s entry point to run under `vite-node`'s runner instead of plain
   `node`, which is a real migration, not a config change.

2. **Bun `--hot`, if a Bun migration is acceptable anyway.** Simplest change by line
   count — one flag, no Vite dependency, `globalThis` persistence documented directly by
   Bun. Weaker guarantee than option 1: Bun's docs promise `globalThis` survives, they do
   not promise the *dependency graph* is invalidated as narrowly as `vite-node`'s
   transitive walk — an edit to a module several hops from `agent.ts` could still
   re-evaluate more than needed. Also a bigger blast-radius decision: it changes werk's
   runtime, not just its dev loop, and Node 25's "no build step, run directly" premise
   (`CLAUDE.md`) would need re-confirming under Bun.

3. **Deno `--watch-hmr`, only if already considering the Deno/Node-26-compat path.**
   Deno's own docs are the most honest about the failure mode werk actually hit: an
   in-flight async function is a named case that forces full restart rather than a
   silent patch — so this option has a documented chance of solving *nothing* for the
   exact "edit lands mid-turn" scenario, degrading safely to the current behavior instead
   of the desired one. Worth reconsidering only if werk moves to Deno for other reasons.

4. **Supervisor/thin-layer split, built by hand.** No off-the-shelf tool implements it;
   the closest primed part is the `globalThis` technique in option 1, which is really this
   option's minimal version already. A full split (separate OS process for the
   supervisor, Unix-socket IPC, a genuinely disposable frontend process) is more
   machinery than the other three options and only pays for itself if option 1's
   in-process approach turns out to still leak state across a reload in practice.

**Flag for prototype (`who: prototype`), not decidable from documentation alone:**

- Whether `vite-node`'s transitive invalidation, applied to werk's actual module graph
  (`cli.ts` → `agent.ts` → `fold.ts`/`log.ts`/`types.ts`), keeps `agent.ts` untouched when
  only `cli.ts` or `fold.ts` changes — the theory is sound per `invalidateDepTree`, but no
  source confirms it for this specific import shape, especially the `Agent` class holding
  a live `ChildProcessWithoutNullStreams` from `node:child_process` (`src/agent.ts:1,147`)
  rather than a plain data object.
- Whether an edit that lands **while `this.busy` is true** (a turn in-flight, per
  `src/agent.ts:174`) is safe under any of these tools, or whether it is the same class of
  "async function currently running" case Deno's own docs name as a forced-restart
  trigger. None of the four runtimes/bundlers document this boundary precisely enough to
  answer without running it.
- Whether Bun's `instanceof`-across-reload gap (an object in an unreloaded module
  referencing a class from a reloaded one) actually bites werk's shape, where `Agent` is
  a single class instantiated once in `server.ts` and referenced by `cli.ts`.

A throwaway prototype: pin an `Agent`-like object to `globalThis`, hold a real
`child_process.spawn` handle on it, run it under (a) `bun --hot`, and (b) a `vite-node`
entry point, then edit an unrelated sibling module mid-spawn and check whether `proc.pid`
is still the same process afterward. That answers all three prototype items above in one
pass.

## 6. Runtime migration: Bun vs. Node as werk's shipped runtime (September 2026)

Separate question from §1–5. §1 asked "does `bun --hot` fix the dev-reload problem." This
section asks "should werk drop Node entirely and ship on Bun." Collected 2026-09-05,
against Bun 1.4.x (`bun --version` reports 1.4.1 on this machine) and Node 25/26.

### 6.1 Node API compatibility for werk's specific calls

Bun's own compatibility docs mark `node:http`, `node:fs`, and `node:crypto` as fully or
mostly implemented, but each carries a caveat that touches werk directly:

- **`node:http`**: "fully implemented" per Bun's docs, but `http.Server` does not extend
  `net.Server`, and `listen(handle)`, `fd`, `ipv6Only`, `signal` are ignored; server-side
  `keepAlive` settings are non-functional. [Node.js Compatibility — Bun
  Docs](https://bun.com/docs/runtime/nodejs-compat) Bun's own docs do not name
  Server-Sent Events as a covered case either way.
- **SSE specifically has an open bug history, not a documented gap.** [`oven-sh/bun`
  #2443 — Support Server Sent
  Events](https://github.com/oven-sh/bun/issues/2443) records that returning a
  `ReadableStream` from `Bun.serve` sends no headers or body until the stream closes —
  the opposite of what SSE needs. That is Bun's native `Bun.serve` API, not
  `http.createServer`, but [`oven-sh/bun` #7716 — `IncomingRequest` fails to emit `close`
  when client disconnects](https://github.com/oven-sh/bun/issues/7716) hits
  `node:http` directly and names the SSE use case by name: cleanup that depends on the
  request's `close` event never runs, which is werk's exact shape (an SSE handler that
  must stop writing when the browser tab closes). [`oven-sh/bun` #13811 — SSE changed in
  1.1.26/1.1.27](https://github.com/oven-sh/bun/issues/13811) is a regression report,
  not a design gap: a working SSE stream broke across two consecutive patch releases,
  one report says it "took down their Linux server." All three issues are still open.
- **`node:child_process`**: Bun's own docs list concrete gaps, not vague ones: IPC
  can pass `net.Socket`/`net.Server`/`dgram.Socket` handles but not HTTP server sockets;
  `subprocess.channel.ref()`/`unref()` is missing; a child's stdout cannot be wired as
  another child's stdio input; `spawnSync` drops extra stdio pipes from its result.
  [Node.js Compatibility — Bun Docs](https://bun.com/docs/runtime/nodejs-compat)
  werk's use — one `spawn` of the `claude` CLI, its stdout read as a stream, its stdin
  written to — is not on this gap list. But [`oven-sh/bun` #30831 — stdio piping between
  processes fails with "TODO: stream.Readable
  stdio"](https://github.com/oven-sh/bun/issues/30831) and [`oven-sh/bun` #4670 —
  child process extra stdio streams not
  implemented](https://github.com/oven-sh/bun/issues/4670) confirm the piping code
  path around `spawn` is still actively growing holes as of 2026, not a finished
  feature.
- **`node:crypto`**: `randomUUID` is supported. Bun uses BoringSSL, not OpenSSL, so it is
  "missing the `ed448`, `x448`, `rsa-pss`, `dsa` and `dh` key types" and some cipher modes
  (CCM, OCB, XTS, ChaCha20-Poly1305). [Node.js Compatibility — Bun
  Docs](https://bun.com/docs/runtime/nodejs-compat) None of these key types or ciphers
  appear in werk's source; not relevant to this repo today.
- **`node:fs`** — Bun's docs claim 98% test-suite parity but do not call out `fs.watch`
  specifics by name in the compatibility page itself.

**Bottom line for werk:** the one werk feature with a real, primary-sourced, currently-open
bug trail on Bun is SSE cleanup on client disconnect (§7716, §13811) — directly relevant
since `src/server.ts` serves SSE. `child_process` piping is documented as gap-free for
werk's simple stdin/stdout case, but has open issues (§30831, §4670) showing the area is
still being hardened, not finished.

### 6.2 TypeScript execution without a build step

Node's native TypeScript support is stable, not experimental, as of the versions werk
targets: type stripping "became stable as of v25.2.0 and v24.12.0," and
`--experimental-transform-types` was removed outright in Node 26.0.0.
[Node.js — Modules: TypeScript](https://nodejs.org/api/typescript.html) The removal is
not a downgrade in maturity — it is Node drawing a hard line: only *erasable* syntax is
supported, permanently. Enums, namespaces that export a runtime value, parameter
properties, and decorators are **not** stripped and throw a parse error; a project using
any of these needs `tsc`/`esbuild`/`tsx` regardless of runtime. [Node.js — Modules:
TypeScript](https://nodejs.org/api/typescript.html) werk's source uses none of these
(checked: no `enum`, no value-exporting `namespace`, no decorators in `src/*.ts`), so this
line does not currently bind werk either way.

Bun runs `.ts` natively with no separate "stable since" milestone to cite — TypeScript
execution has been a baseline Bun feature since 1.0. Bun's TypeScript handling is a
superset of Node's erasable-only rule: Bun transforms enums and namespaces at load time
rather than rejecting them, so a file using `enum` runs on Bun and fails on Node 26 with
`--no-strip-types` unset. This is the one concrete case where Bun's TS support is strictly
wider than Node's, not narrower — but only matters if werk starts using enums/namespaces,
which it does not today.

**Net effect on the "no build step" premise:** both runtimes satisfy it today, for code
that avoids enums/namespaces/decorators/parameter properties — which is exactly the
subset CLAUDE.md's existing code already sits in. This question does not favor a Bun
migration; it is already answered on Node.

### 6.3 Startup time and single-executable distribution

Node's Single Executable Applications (SEA) feature is explicitly **not** stable:
Node 26's own docs mark it "Stability: 1.1 – Active development."
[Node.js — Single executable
applications](https://nodejs.org/api/single-executable-applications.html) Node 25.5.0
added `--build-sea` to collapse the previous multi-step `postject`-based workflow into
one command, but limitations remain primary-sourced and concrete: cross-platform builds
must set `useCodeCache`/`useSnapshot` to `false`; `import()` does not work when
`useCodeCache` is `true`; only `require.main` is available on the injected `require`;
`import.meta.resolve` is unsupported; SEAs built in Linux arm64 Docker containers have a
known crash on `process.dlopen()`. [Node.js — Single executable
applications](https://nodejs.org/api/single-executable-applications.html)

Bun ships `bun build --compile` as its answer and has explicitly declined to build
`node:sea` support at all: "node:sea support is not planned or implemented — you can use
`bun build --compile`." [`node:sea` — Bun
Docs](https://bun.com/reference/node/sea) Independently reproducible benchmark data
(published by Vue's Evan You, cross-checked against Bun's own maintainer) puts
`bun build --compile` with bytecode enabled at "25% faster startup time than Node SEA +
code cache" as of Bun 1.3.9, while noting a counter-example: a Rolldown-bundled Node SEA
beat `bun --compile` in a separate benchmark, so the maintainer's own conclusion is "Node
SEA is still competitive," not a clean win for Bun.
[bun-vs-node-sea-startup — GitHub](https://github.com/yyx990803/bun-vs-node-sea-startup)

**Bottom line:** werk does not currently distribute a compiled binary at all — it runs as
source under `node --watch`. This whole axis is not a present cost or gain for werk; it
would only start to matter if werk's distribution model changes from "clone and run" to
"ship a binary," which is not stated anywhere in CLAUDE.md or the design docs.

### 6.4 npm ecosystem compatibility — relevant only if werk adds dependencies

werk has zero dependencies today (`package.json`, `CLAUDE.md`: "There is no build step and
no dependencies"). Bun's install-time gaps are real but gated entirely behind adding a
dependency: native addons compiled against V8 internals (Bun uses JavaScriptCore, not V8)
do not load — Bun's own docs on native addon support describe this as a structural
mismatch, not a bug to be fixed. Lifecycle scripts (`postinstall`) are blocked by default
since Bun 1.1 and must be explicitly trusted per package. These are documented,
reproducible constraints, but they bind zero code in werk as it stands. **This axis is
inert for werk today** — it becomes live only the day a `package.json` dependency is
added, and even then only for native-addon or postinstall-script packages specifically.

### 6.5 Maturity and stability signals

Bun 1.4.0 (2026-08-19) is described in its own tracking issue as a full rewrite of the
runtime from Zig to Rust, bundled with a large, itemized breaking-change list spanning the
package manager, `Bun.serve`, TLS/networking defaults, `child_process`, and the module
system — including "Node.js compatibility target bumped from 24.3.0 to 26.3.0," which by
itself invalidates native addons built against the prior target.
[`oven-sh/bun` #28792 — List of breaking changes for
1.4](https://github.com/oven-sh/bun/issues/28792) A version-only rewrite of this size,
landing as a point release (1.3→1.4, not a major-version bump), is a different stability
posture than Node's semver-major-gated breaking changes.

Node's LTS model is the primary-sourced counterpoint: even-numbered lines get 30 months of
LTS support with a published, years-ahead schedule; Node 26 enters LTS October 2026 and
reaches end-of-life April 2029; from October 2026 the project is also moving to one major
release per year with every release becoming LTS, specifically to reduce the number of
concurrently supported lines. [Node.js — Evolving the Node.js Release
Schedule](https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule)
This is the sharpest asymmetry found on this whole question: Node is contracting its
release surface to raise predictability per line; Bun, in the same window, shipped a
full internal-language rewrite inside a single point release.

**For a single-maintainer tool, this matters more than any feature gap.** A breaking Bun
point release means werk's maintainer must read a changelog before any routine upgrade
that currently would be a silent, safe `git pull`. A Node LTS line does not carry this
requirement by design.

### 6.6 Named gaps that map directly onto werk's shape

Cross-checked against werk's actual code, not a generic feature list:

1. **`src/agent.ts` spawns `claude` and pipes stdin/stdout/stderr as a long-lived
   process.** Bun's own docs list concrete `child_process` gaps (IPC handle types,
   `channel.ref()`/`unref()`, chained stdio between children), none of which match
   werk's single-child, simple-pipe pattern — but two 2026 open issues (`#30831`,
   `#4670`) show the surrounding piping code is still actively being patched, which is a
   signal about *risk of regression on upgrade*, not a signal that today's code is
   broken.
2. **`src/server.ts` serves SSE over plain `http.createServer`.** This is the one area
   with a directly-named, open, primary-sourced bug (`#7716`) whose reproduction case is
   exactly "SSE handler needs the `close` event to stop writing" — the single largest,
   most concrete cost found anywhere in this research for moving werk to Bun.
3. **File watching** (`node --watch` today). Not covered in this research pass — Bun's
   `--watch`/`--hot` behavior was already covered in §1 above; no new primary source
   surfaced a `fs.watch`-specific gap for Bun beyond what §1 already states.

### Recommendation (runtime migration question)

**Stay on Node.** Ranked reasons, strongest first:

1. **SSE-on-disconnect is an open, named, reproduced bug on the exact code path werk
   uses** (`http.createServer` + `close` event), not a theoretical gap — §7716 and §13811
   are both open as of this research. Moving werk's server to Bun trades a working
   feature for one with a live bug report matching werk's own use case.
2. **Node already satisfies every premise in `CLAUDE.md`.** "No build step, no
   dependencies" holds today on Node 25/26 for code that avoids enums/namespaces/
   decorators — which is exactly werk's code. Bun's TS support being a superset (it
   also runs enums) is a gain with no current use, since werk uses none.
3. **The other cited Bun advantages — faster startup, `bun build --compile` — answer a
   distribution problem werk does not have.** werk ships as source, run directly; no
   design doc states an intent to ship a compiled binary.
4. **Bun 1.4's rewrite-inside-a-point-release, with an itemized breaking-change list
   spanning HTTP, TLS, and child_process defaults, is a materially different stability
   posture than Node's LTS-scheduled majors** — a real cost for a single maintainer with
   no team to absorb a breaking upgrade's blast radius.
5. **Zero dependencies today makes the npm-compatibility question moot**, so it cannot be
   scored as a reason to move either direction; it would only start to count against Bun
   if werk added a native-addon dependency later.

This is not a coin-flip. Every axis that has a documented difference (SSE reliability,
release stability posture) favors Node for werk's specific shape; every axis that favors
Bun (startup speed, single-binary output) answers a problem werk does not currently have.
Revisit only if werk starts shipping a compiled binary, or if `#7716`/`#13811` close with
a fix and enough time passes to trust the fix under load.

## Sources

- [Watch Mode — Bun Docs](https://bun.com/docs/runtime/watch-mode)
- [Hot reload an HTTP server — Bun Guides](https://bun.com/guides/http/hot)
- [Vite — Server-Side Rendering (middleware mode, `ssrLoadModule`)](https://vite.dev/guide/ssr.html)
- [Vite — HMR API](https://vite.dev/guide/api-hmr)
- [`vite-node` `moduleCache.invalidateDepTree` — vitest-dev/vitest commit
  b8922aa](https://github.com/vitest-dev/vitest/commit/b8922aa1954fc6c208ac8ef5698c57774938c323)
- [Vitest API docs — manual cache invalidation note](https://vitest.dev/advanced/api/vitest)
- [Deno 1.38: HTML doc generator and HMR](https://deno.com/blog/v1.38)
- [Deno 1.46: The Last 1.x Release](https://deno.com/blog/v1.46)
- [Deno docs — Watch mode and HMR](https://docs.deno.com/runtime/run/watch_mode/)
- [Deno 2.9](https://deno.com/blog/v2.9)
- [`denoland/deno` #28754 — atomic save detaches `--watch-hmr` on Linux](https://github.com/denoland/deno/issues/28754)
- [Node.js CLI docs — `--watch`, `--watch-kill-signal`, `--watch-path`](https://nodejs.org/api/cli.html#--watch)
- [Node.js v26.0.0 release notes](https://nodejs.org/en/blog/release/v26.0.0/)
- [Prisma Documentation — Database connections (`globalThis` singleton)](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections)
- [PM2 — Watch & Restart](https://pm2.io/docs/runtime/features/watch-restart/)
- [`catflap` — FD-passing socket handoff for restart-surviving servers](https://github.com/passcod/catflap)
- `src/agent.ts:1,147,174` — `Agent` class, spawned child handle, `busy` flag (this repo)
- `package.json` — `dev` script running `node --watch src/cli.ts serve` (this repo)
- [Node.js Compatibility — Bun Docs](https://bun.com/docs/runtime/nodejs-compat)
- [`oven-sh/bun` #2443 — Support Server Sent Events](https://github.com/oven-sh/bun/issues/2443)
- [`oven-sh/bun` #7716 — `IncomingRequest` fails to emit `close` event on disconnect](https://github.com/oven-sh/bun/issues/7716)
- [`oven-sh/bun` #13811 — SSE changed/broke in Bun v1.1.26/1.1.27](https://github.com/oven-sh/bun/issues/13811)
- [`oven-sh/bun` #30831 — stdio piping between processes fails ("TODO: stream.Readable stdio")](https://github.com/oven-sh/bun/issues/30831)
- [`oven-sh/bun` #4670 — child process extra stdio streams not implemented](https://github.com/oven-sh/bun/issues/4670)
- [`oven-sh/bun` #28792 — List of breaking changes for 1.4](https://github.com/oven-sh/bun/issues/28792)
- [Node.js — Modules: TypeScript](https://nodejs.org/api/typescript.html)
- [Node.js — Single executable applications](https://nodejs.org/api/single-executable-applications.html)
- [`node:sea` — Bun Docs (declines to implement, points to `bun build --compile`)](https://bun.com/reference/node/sea)
- [`bun-vs-node-sea-startup` benchmark — yyx990803/GitHub](https://github.com/yyx990803/bun-vs-node-sea-startup)
- [Node.js — Evolving the Node.js Release Schedule](https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule)
