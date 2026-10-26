# werk — how to work with the decision map

This project keeps its decisions in a werk map. These instructions hold in any project werk
works on. Every command below runs the werk command line on this project's map.

## Keep the map current, every turn

When the conversation settles something, append it to the log **in the same turn**:

```bash
werk add <id> --title "..." --why "..." --parent <id> --status <s> --who <w>
werk link <from> <to> --type depends_on --why "what <from> takes from <to>"
werk status <id> decided
werk reopen <id>
```

Do not batch this up for later. The map is the record of what the conversation established.
The transcript is not.

## A card you add is a proposal. Only Eryk accepts it

`add` no longer puts anything in the map. Every kind — card, option, source, excerpt — enters
the log as a ghost: dashed and grey in the tree, in no rollup, with every edge of its own
held until it goes real. Eryk clicks ✓ on the card, or runs `accept <id> --actor you`.

Three rules follow from it:

1. **Write the whole card in the `add` call.** A ghost is frozen. `edit --body`, `edit --why`
   and `retitle` all refuse, and so does a second `add` with the same id. The only correction
   is `discard <id>`, then propose it again with the new wording.
2. **`link`, `status` and `say` still work on a ghost.** An edge on a ghost is held and drawn,
   and `status <id> decided` runs the same contract check against those held edges. So build
   the card exactly as before — add, link, options, decided — and it commits as one unit.
3. **Do not run `accept` yourself.** It fails without `--actor you`, and `--actor you` is a
   claim that Eryk asked for it. Say at the end of the turn what is waiting for him.

Accepting a card also accepts its ghost `refines` parents and its own ghost options and
sources. It never accepts a `depends_on` target — that is a different card, with its own words.

## Removing a card is reversible, and it is Eryk's call

`remove <id>` takes a card and its `refines` subtree out of the map. Nothing leaves the log:
`restore <id>` puts it back and `removed` lists what is out. `--reparent` lifts the direct
children to the grandparent first, for a bad parent over good children.

Propose the removal, do not perform it. If a card should go, say which one and why, and let
him press ✕. The exception is a ghost you yourself proposed and he has not accepted: discard
that one freely, it was never in the map.

## Do not touch the product diagram

`.werk/diagram-grid-full-minimal.wgrid` is a second, hand-authored description of the product:
its parts and how they connect, as the decided cards describe them. `werk serve` keeps it in
step with the decided cards by itself: a log change that touches a decided card starts
sysdiag-scout and sysdiag-updater in the background, outside every chat.

So do not start those subagents, do not read or edit the `.wgrid` file, and do not mention the
diagram in your reply. The diagram view shows when a run is going or has failed.

## Before deciding what to test, classify the module first

Pure code gets a coverage number. I/O code gets a list of named behaviours. Never set one
percentage over a whole project.

To classify a module, ask one question: does a wrong line fail loudly — throw, hang, crash —
or does it quietly give a result that looks correct? A quiet wrong answer means the module is
pure. A loud failure means it is I/O: it holds something live, such as a child process, a
socket, an open file, or a network call.

- A pure module gets a high line-coverage threshold. A test of it is cheap, and a bug in it
  never shows itself.
- An I/O module gets a list of named behaviours and no percentage. To cover a line there, a
  test must fake the live thing, and a percentage rewards the fake. Find the behaviours by
  reading the module against one brief, "name what breaks the tool if this is wrong". Each
  doubt is a fact question or a design question. A fact question asks what the code does:
  read the source and settle it. A design question asks what the code should do: only a
  person decides it, with at least two contrasting options in front of them.
- Write each behaviour as a responsibility, not as a location. "A crash never loses the
  message in flight" stays true after a rewrite. "Line 326 throws" does not.

Use PROACTIVELY whenever the build step is about to decide what to test, or to what coverage,
for a module that has no test policy on the map yet — normally right after a new module is
written or reshaped enough to change its shape, before its tests are written.

1. `test-scope` — read-only. Hand it the file path(s). It classifies each as pure or I/O, and
   for an I/O module reads it to produce a candidate behaviour list, resolving any fact
   question against source before it reports.
2. Write what it reports into the module's own tests, not onto the map. The map holds rules,
   not one module's results:
   - A pure module: gate it with the project's own numeric threshold. If none is decided yet,
     write one card saying the threshold needs deciding once for the whole project — do not
     pick a number yourself.
   - An I/O module: write the resolved behaviour list as the module's named test cases. Write
     a card only for a real design-question fork `test-scope` could not settle — put it in
     front of Eryk with at least two contrasting options.

Most turns end with tests and no new card. A card appears only when `test-scope` hands back a
genuine design-question fork, or reports that the project has no coverage-threshold policy yet.

## Eryk refers to cards by id

An id looks like `#checkout-retry`. When he pastes `re #<id> "<title>": ...`, he typed that in
the map. Run `werk inbox` to read the whole thread, then reply with
`werk say <id> "..."` so the answer lands on the card, not only in the terminal.

## Record `depends_on` at the moment you create a card

A single-hop model check recovers only 6% to 11% of an invalidation chain. There is no way
to reconstruct these edges later. If a card is true only because another card is true, write
the edge now, or staleness propagation is dead and the map rots into a pretty outline.

`refines` is where a card **sits**. `depends_on` is what a card **needs**. They are different
graphs over the same nodes. That is the whole point.

## Record a rejected option the moment you weigh it

When a decision comes from real contrast in conversation — you named an alternative, gave a
reason, and rejected it — add that alternative as its own `option` node with `--why_not`, and
link it `alternative_to` the decided card, in the same turn:

```bash
werk add <id>:opt0 --kind option --title "..." --why_not "..."
werk link <id>:opt0 <id> --type alternative_to
```

If you skip this, the card is indistinguishable later from one decided with no contrast at
all — the `unchallenged` marker cannot tell "no option was weighed" from "an option was
weighed but never written down."

## Say so when a card you just made comes out stale

A change marks the next hop only: its direct dependents and its direct children. A link made
after the change carries no mark from it. So a new card is not marked stale by a reopen that came
before its links. If the server marks it anyway, the server runs old code: restart
`werk serve`.

A new card can still depend on a target that is stale now. Then the card waits. It is not
stale. Say it in the same turn: name the stale target, and say the card was
written with that correction already in hand.

Run `werk show <id>` after you create a card. It prints the whole trace — origin,
reason, date, the hops. If a mark remains, either clear it,

```bash
werk rederive <id> --status decided
```

or leave it and say why not. Do not leave a red mark unexplained.

A ghost is never marked: its `depends_on` edges are held. Run `show` on what it depends on,
and say the result in the turn that proposes the card, not later.

## Point at a depends_on target. Do not restate it

Once a card has a `depends_on` edge, do not copy the target card's decided content into this
card's body. Write "see #<id>" and state only what is unique to this card.

A copy is a second source of truth. If the target changes, staleness propagation marks the
edge, not the prose — the body still reads as if the old decision holds. Example: a card
repeats the count of tracker verbs that the card it depends on gives. That card later gets a
seventh verb. The copy is now wrong, and no mark shows it.

## Write a card about its subject, at the level of the decision

These rules apply to every title, why, body, and `why_not` you write on a card.
No program checks the text, so check it yourself before every `add`, `edit`, and
`retitle`. Someone reads a card later, cold, and needs to act on its subject. Session facts
are already stale when that person reads them.

1. **No session narration.** Do not write who said what, what came before, or what stage
   the conversation is at. Delete "Eryk said", "as discussed", "the next thing to prove", and
   "for now, until we...". Attribution goes in `--who` and in the log.
2. **No edit history.** Do not write "X is new", "Y used to say Z", or "that no longer
   applies". Do not write where text came from: "moved here from #x", "split out of #y",
   "merged from #z". State the current fact. The log records the change.
3. **A reversal is a fact about the subject.** A superseded card may say what replaced it
   and why the earlier reading was wrong. Write it as a fact, not as a story of the
   conversation.
4. **No code names.** Do not name source files, functions, classes, constants, line
   numbers, or internal endpoints. Name behaviour and concepts. Code changes with every
   refactor. The code points to the card, not the other way round.
5. **No commands or flags outside the command-line cards.** The form of a command — its
   verb, flags and output — lives on one card under the card for the project's command line.
   Every other card names the operation ("a reopen with the reason postponed", "the merge
   loop") instead. A command card depends on the cards that define its operations. No other
   card depends on a command card.
6. **Rules, not one module's results.** A module's behaviour list, coverage threshold, or
   test plan goes into that module's tests. A card about one module is fair only if that
   module raises a design question that the general rule cannot answer.
7. **No list of child cards.** The refines edges already hold the children, and the map
   draws them. A copy in the body drifts when a child is added, moved, or removed. State
   the card's own higher-level fact. Where a sentence states a fact that a child expands,
   name the child in parentheses after it. Avoid bullet and numbered lists in a body in
   general. A list whose items mirror the children is never correct.

```
# WRONG
title: "Eryk wants the export moved into exportOrders() for now"
body:  "This used to be part of #orders. We split it out after the review."

# CORRECT
title: "Export is its own command"
body:  "The export writes every order as one file. See #order-format for what an order holds."
```

## Make a card easy to read cold

A card reads in three layers. The title says what the card is about. The why gives most of
the understanding, so a reader can stop there. The body holds the details for the reader who
must act. These rules come from the requests Eryk repeats most often: "what does this mean?", "this title is cryptic",
"reword it", "give me an example", "visualize it". Each of them means a card broke one rule
below. Check every card against them before `add` and `propose`, in the chat and in a build.

1. **Title: one plain sentence about this card's own rule.** A subject and a verb. No "now",
   no tool or subagent names. No count that a later change can make wrong ("seven steps",
   "four categories"), unless the title names every member. Do not name another decision
   ("the same check as accept"). That ties two cards that can change on their own.
2. **Why: 80% of the understanding in two or three sentences.** Give the reason as plain
   causal steps. No card references, no commands. Do not repeat the body.
3. **Body: the decision, not the process.** State the problem, then the answer: "To avoid
   X, the map does Y". A decided card records the answer, not the question. Give a general
   overview, not a summary of the subcards.
4. **Every term is plain English or defined.** A term that a decided card defines is fine.
   A term that this card adds gets a plain definition where it first appears. Do not coin
   phrases: "fans out a calm mark", "the actor claim is the nearest check", "one read size",
   "cards give the edges", "the staged removal path" all needed a second explanation.
5. **The card reads on its own.** It does not need a past state of the product, a removed
   card, or the conversation. An example that was the evidence goes on a source node, with
   enough context to read months later.
6. **A mechanism card shows one worked example and a picture.** If the card says what
   happens when someone acts, add an example: a bullet list of named things with plain
   titles (X "We charge per seat"), then numbered steps, one action and its result per
   step, with the case where nothing happens. Then an ASCII picture in a code block that
   uses the same names and symbols. Label every number and symbol. Show the rule as it holds
   now, from the user's side. Do not set an old and a new version side by side. The ban on
   lists in a body does not apply to the lists of an example.
7. **A card about a reusable product holds for every project that uses it.** It names no
   internals of the one project where the product was first built.

When Eryk asks what a phrase on a card means, answer in plain terms in the chat. Then fix
the card in the same turn, so the next reader does not need to ask. For a ghost, discard
it and propose it again. For a decided card, stage the change with a proposal.

A ghost is frozen. Wording you get wrong in `add` costs a `discard` and a new `add`, so check
before you send.

## Record a follow-up before you change finished work

When Eryk asks you to change work that a finished build delivered — a ticket in done — record
it first, in the same turn, then do the work:

```bash
werk followup <ticket> --class plan|build --found review|after-merge --why "..." [--catchable yes|no]
```

Read the cards the ticket cites before you choose the class. If the cards say what he now
asks for, the build got it wrong: `--class build`, and say with `--catchable` whether a check
could have caught it. If no card says it, or a card says something else: `--class plan`.
`--found review` means the run's gate has not passed yet; otherwise `after-merge`.

Say the record in one line of your reply. If he says the class is wrong, correct it with
`--of <n>`; never write a second record for the same request. A ticket that is not done yet
gets no record: the build is not finished.

## Tag who decides

`--who you` — Eryk has a basis. Ask him.
`--who me` — Reversible. Decide it, say so, do not ask.
`--who prototype` — Neither of you can know by talking. Build it first, then decide.

Attach a concrete preview to any question you do ask. A preview is a small prototype.

## Two rules from the design

1. **Logic goes in a program. Markdown holds prompt text only.** This tool must be able to
   become a product. A skill file cannot.
2. **The tool must stay complementary.** It coaches judgement. It does not decide.

## Two places you may be running

If you read this from the chat pane inside werk, the map is open next to you. A line like
`[the map is now at #id — title]` or `[still on #id — title]` names the card Eryk is
looking at, on every turn, not only when it changes. Answer short.
Put the detail on a card, because he is reading the map, not the chat.

Unless he names a different id, "this card" or "current" means the one in that line.

In a chat reply, name a map operation and its card, not the command line that runs it. He
acts in the map, not in a terminal. Write "Next: accept #checkout-retry", not
`werk accept checkout-retry --actor you`. You still run the full command
yourself. Write a full command line only when he must run it in a terminal.

If you read this from a terminal, run `werk inbox` to catch up on notes.

## Read images directly. Use a subagent only in two cases

A `Read` of a PNG or JPG gives the model a native image block. One image costs less than
5k tokens, so read it directly by default.

Use an `Agent` to read the image in two cases only:

1. A render-and-check loop that will read more than about 10 images in one session.
2. You need only a short text fact from the image.

Tell the subagent what to check. A text report loses overlaps, spacing, and colors.
