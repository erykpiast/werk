import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent, readBoard, readBoardLog } from "../src/board/log.ts";
import { readMap } from "../src/map/store.ts";
import type { Step } from "../src/test/fake-script.ts";
import { type Project } from "../src/test/project.ts";
import { watchTickets } from "../src/tickets/watch-run.ts";
import { card, dep, freshProject, seed, type Ev } from "./d-lib.ts";

const SPEC = `# Spec: checkout

## User stories

1. As a person, I want to pay.
2. As a person, I want a retry.

## Test seams

The command line.
`;
const ticket = (title: string, cites: string, blocked: string, stories: string, acceptance = true) =>
  [
    `title: ${title}`, `cites: ${cites}`, `blocked_by: ${blocked}`, `stories: ${stories}`, "touches: pay", "",
    "## What to build", "", "A person pays.", "",
    ...(acceptance ? ["## Acceptance criteria", "", "- It works.", ""] : []),
    "## Checks", "", "- `make test`", "",
  ].join("\n");
const edit = (path: string, content: string): Step => ({ edit: { path, content } });

function proj(extra: Ev[] = []): Project {
  const p = freshProject();
  seed(p, [card("root"), card("checkout", "root"), card("checkout-pay", "checkout"), { type: "kill.added", payload: { id: "checkout-pay", criterion: { form: "revisit" } } }, { type: "kill.added", payload: { id: "checkout", criterion: { form: "revisit" } } }, ...extra]);
  return p;
}
async function withTarget(p: Project) {
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
}
const GOOD: Record<string, string> = {
  "01.md": ticket("Pay", "checkout, checkout-pay", "", "1"),
  "02.md": ticket("Retry", "checkout-pay", "", "2"),
};
const answer = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Which ${slug}?`, body: "Body." });
function writers(p: Project, o: { tickets?: Record<string, string>; spec?: unknown[]; tick?: unknown[] } = {}) {
  p.script({
    roles: {
      "spec-writer": { replies: [[edit(".werk/specs/checkout.md", SPEC), edit(".werk/specs/checkout.spec-answers.json", JSON.stringify(o.spec ?? []))]] },
      "ticket-writer": {
        replies: [[
          ...Object.entries(o.tickets ?? GOOD).map(([f, t]) => edit(`.werk/tickets/checkout/${f}`, t)),
          edit(".werk/specs/checkout.ticket-answers.json", JSON.stringify(o.tick ?? [])),
        ]],
      },
    },
  });
}
const board = (p: Project) => readBoard(join(p.dir, ".werk", "board.jsonl"));
const bevents = (p: Project) => readBoardLog(join(p.dir, ".werk", "board.jsonl")).events;

test("28.1 plan writes spec, tickets, ghosts", async () => {
  const p = proj();
  await withTarget(p);
  writers(p, { spec: [answer("retry-limit")], tick: [answer("ticket-order")] });
  const r = await p.werk(["plan", "checkout"]);
  console.log(r);
  expect(r.code).toBe(0);
  expect(existsSync(join(p.dir, ".werk", "specs", "checkout.md"))).toBe(true);
  for (const id of ["checkout/01", "checkout/02"]) expect(["ready", "blocked"]).toContain(board(p).tickets.get(id)?.column as string);
  const map = readMap("t", join(p.dir, ".werk", "log.jsonl"));
  for (const id of ["checkout-retry-limit", "checkout-ticket-order"]) {
    expect(map.nodes.get(id)).toMatchObject({ proposed: true, who: "me" });
    expect(map.ghostEdges).toContainEqual({ from: id, to: "checkout", type: "refines" });
  }
  const show = await p.werk(["show", "checkout-retry-limit"]);
  console.log(show.out);
  const ev = bevents(p);
  expect(ev[0]?.type).toBe("plan.started");
  expect(ev.at(-1)?.type).toBe("plan.ended");
  const steps = ev.filter((e) => e.type === "plan.step") as { payload: { step: string; log?: string } }[];
  expect(steps.filter((s) => s.payload.step === "spec writer" && s.payload.log).length).toBe(1);
  expect(steps.filter((s) => s.payload.step === "ticket writer" && s.payload.log).length).toBe(1);
});

test("28.2 open card stops plan", async () => {
  const p = proj([{ type: "node.added", payload: { id: "checkout-draft", kind: "card", title: "Draft", parent: "checkout" } }]);
  await withTarget(p);
  writers(p);
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("checkout-draft");
  expect(p.launches()).toEqual([]);
  expect(board(p).tickets.size).toBe(0);
});

test("28.3 scope tiers", async () => {
  const p = freshProject();
  seed(p, [
    card("root"), card("checkout", "root"), card("payments-api", "root"), card("auth", "root"),
    card("auth-token", "auth"), card("auth-sso", "auth"),
    dep("checkout", "payments-api"), dep("payments-api", "auth-token"),
  ]);
  await withTarget(p);
  writers(p);
  await p.werk(["plan", "checkout"]);
  const ls = p.launches();
  expect(ls.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  const spec = ls[0]?.messages[0] as string;
  const t2 = spec.indexOf("## Tier two");
  expect(t2).toBeGreaterThan(0);
  expect(spec.indexOf("### #checkout")).toBeGreaterThan(-1);
  expect(spec.indexOf("### #checkout")).toBeLessThan(t2);
  expect(spec.indexOf("### #payments-api")).toBeLessThan(t2);
  expect(spec.indexOf("### #auth-token")).toBeGreaterThan(t2);
  for (const l of ls) {
    const text = (l.messages[0] as string) + l.args.join(" ");
    expect(text).not.toContain("auth-sso");
    expect(text).not.toMatch(/#auth(?![\w-])/);
  }
  expect((ls[0]?.messages[0] as string) + ls[0]?.args.join(" ")).toContain("spec writer");
  expect((ls[1]?.messages[0] as string) + ls[1]?.args.join(" ")).toContain("ticket writer");
});

test("28.4 taken answer id fails, bad ticket off board", async () => {
  const p = proj([card("checkout-retry-limit", "checkout")]);
  await withTarget(p);
  writers(p, { spec: [answer("retry-limit")], tickets: { "01.md": ticket("Pay", "checkout, checkout-pay, checkout-retry-limit", "", "1"), "02.md": ticket("Bad", "checkout-pay", "", "2", false) } });
  const r = await p.werk(["plan", "checkout"]);
  console.log(r);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("checkout-retry-limit");
  const map = readMap("t", join(p.dir, ".werk", "log.jsonl"));
  expect([...map.nodes.keys()].filter((k) => k === "checkout-retry-limit").length).toBe(1);
  expect(["ready", "blocked"]).toContain(board(p).tickets.get("checkout/01")?.column as string);
  expect(board(p).tickets.has("checkout/02")).toBe(false);
});

test("28.5 target", async () => {
  const p = proj();
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("werk target");
  const f = join(p.dir, "plain.txt");
  writeFileSync(f, "x");
  expect((await p.werk(["target", f])).code).not.toBe(0);
  expect((await p.werk(["target"])).code).not.toBe(0);
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "s"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
  const out = await p.werk(["target"]);
  expect(out.out.trim()).toBe(p.target);
});

// ---- 29
const SPEC2 = `# Spec: checkout

## User stories

1. As a person, I want to pay.
2. As a person, I want a retry.
3. As a person, I want a refund.

## Test seams

x
`;
function twoPlans(p: Project, second: { spec: string; tickets: Record<string, string> }) {
  const files = (t: Record<string, string>) => Object.entries(t).map(([f, x]) => edit(`.werk/tickets/checkout/${f}`, x));
  const ans = (k: string) => edit(`.werk/specs/checkout.${k}-answers.json`, "[]");
  p.script({
    roles: {
      "spec-writer": { replies: [[edit(".werk/specs/checkout.md", SPEC), ans("spec")], [edit(".werk/specs/checkout.md", second.spec), ans("spec")]] },
      "ticket-writer": { replies: [[...files({ ...GOOD, "03.md": ticket("Third", "checkout-pay", "", "2") }), ans("ticket")], [...files(second.tickets), ans("ticket")]] },
    },
  });
}
const cols = (p: Project) => [...board(p).tickets.values()].map(({ id, title, column, archived }) => ({ id, title, column, archived }));

test("29.1 replan extends spec and numbering", async () => {
  const p = proj([card("checkout-refund", "checkout")]);
  await withTarget(p);
  // first plan covers checkout + checkout-pay + checkout-refund; ensure all cited
  const first = { "01.md": ticket("Pay", "checkout, checkout-pay, checkout-refund", "", "1"), "02.md": ticket("Retry", "checkout-pay", "", "2"), "03.md": ticket("Third", "checkout-pay", "", "2") };
  const files = (t: Record<string, string>) => Object.entries(t).map(([f, x]) => edit(`.werk/tickets/checkout/${f}`, x));
  const ans = (k: string) => edit(`.werk/specs/checkout.${k}-answers.json`, "[]");
  p.script({ roles: {
    "spec-writer": { replies: [[edit(".werk/specs/checkout.md", SPEC), ans("spec")], [edit(".werk/specs/checkout.md", SPEC2), ans("spec")]] },
    "ticket-writer": { replies: [[...files(first), ans("ticket")], [...files({ "03.md": ticket("Third rewritten", "checkout-pay, checkout-refund", "", "2"), "04.md": ticket("Refund", "checkout-refund", "", "3") }), ans("ticket")]] },
  } });
  const r1 = await p.werk(["plan", "checkout"]);
  expect(r1.code).toBe(0);
  appendBoardEvent(join(p.dir, ".werk", "board.jsonl"), "ticket.moved", { id: "checkout/01", to: "building" });
  appendBoardEvent(join(p.dir, ".werk", "board.jsonl"), "ticket.moved", { id: "checkout/02", to: "building" });
  appendBoardEvent(join(p.dir, ".werk", "board.jsonl"), "ticket.moved", { id: "checkout/02", to: "merging" });
  appendBoardEvent(join(p.dir, ".werk", "board.jsonl"), "ticket.moved", { id: "checkout/02", to: "done" });
  seed(p, [card("checkout-new", "checkout")]);
  const r = await p.werk(["plan", "checkout"]);
  console.log(r);
  expect(readFileSync(join(p.dir, ".werk", "specs", "checkout.md"), "utf8")).toBe(SPEC2);
  const c = cols(p);
  console.log(c);
  expect(c.map((t) => t.id)).toEqual(["checkout/01", "checkout/02", "checkout/03", "checkout/04"]);
  expect(c[0]?.column).toBe("building");
  expect(c[1]?.column).toBe("done");
  expect(c[2]?.title).toBe("Third rewritten");
});

test("29.2 archive on replan, restore", async () => {
  const p = proj();
  await withTarget(p);
  const SPEC13 = SPEC2.replace("2. As a person, I want a retry.\n", "");
  const files = (t: Record<string, string>) => Object.entries(t).map(([f, x]) => edit(`.werk/tickets/checkout/${f}`, x));
  const ans = (k: string) => edit(`.werk/specs/checkout.${k}-answers.json`, "[]");
  p.script({ roles: {
    "spec-writer": { replies: [[edit(".werk/specs/checkout.md", SPEC), ans("spec")], [edit(".werk/specs/checkout.md", SPEC13), ans("spec")]] },
    "ticket-writer": { replies: [
      [...files({ "01.md": ticket("Pay", "checkout", "", "1"), "02.md": ticket("Retry", "checkout, checkout-pay", "", "2") }), ans("ticket")],
      [...files({ "03.md": ticket("Refund", "checkout", "", "3") }), ans("ticket")],
    ] },
  } });
  const r0 = await p.werk(["plan", "checkout"]);
  console.log(r0);
  expect(r0.code).toBe(0);
  console.log(await p.werk(["remove", "checkout-pay", "--actor", "you"]));
  const r = await p.werk(["plan", "checkout"]);
  console.log(r);
  const t = board(p).tickets.get("checkout/02");
  expect(t?.archived).toBe(true);
  const arch = bevents(p).find((e) => e.type === "ticket.archived") as { payload: { reason?: string } } | undefined;
  expect(arch?.payload.reason).toMatch(/no longer needs/);
  expect((await p.werk(["ticket", "restore", "checkout/02"])).code).toBe(0);
  expect(board(p).tickets.get("checkout/02")).toMatchObject({ archived: false });
});

test("29.3 retitle blocks, replan clears", async () => {
  const p = proj();
  await withTarget(p);
  writers(p);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  console.log(await p.werk(["propose", "checkout-pay", "--title", "Pay with a new name"]));
  console.log(await p.werk(["accept", "checkout-pay", "--actor", "you"]));
  const log = join(p.dir, ".werk", "log.jsonl");
  const w = watchTickets(log);
  console.log(w);
  const t = board(p).tickets.get("checkout/01");
  expect(t?.column).toBe("blocked");
  expect(t?.reason).toContain("checkout-pay");
  expect(t?.reason).toMatch(/title/);
  const one = [edit(".werk/specs/checkout.md", SPEC), edit(".werk/specs/checkout.spec-answers.json", "[]")];
  const two = [...Object.entries(GOOD).map(([f, t]) => edit(`.werk/tickets/checkout/${f}`, t)), edit(".werk/specs/checkout.ticket-answers.json", "[]")];
  p.script({ roles: { "spec-writer": { replies: [one, one] }, "ticket-writer": { replies: [two, two] } } });
  const r2 = await p.werk(["plan", "checkout"]);
  console.log(r2);
  expect(board(p).tickets.get("checkout/01")?.column).not.toBe("blocked");
});

test("29.4 note blocks nothing; body change blocks ready only", async () => {
  const p = proj();
  await withTarget(p);
  writers(p);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  appendBoardEvent(join(p.dir, ".werk", "board.jsonl"), "ticket.moved", { id: "checkout/02", to: "building" });
  const log = join(p.dir, ".werk", "log.jsonl");
  console.log(await p.werk(["say", "checkout-pay", "a note"]));
  watchTickets(log);
  expect(board(p).tickets.get("checkout/01")?.column).toBe("ready");
  expect(board(p).tickets.get("checkout/02")?.column).toBe("building");
  // change the body of a decided card: propose + accept
  const pr = await p.werk(["propose", "checkout-pay", "--ops", JSON.stringify([{ tag: "new", new: "New body text" }])]);
  console.log(pr);
  const ac = await p.werk(["accept", "checkout-pay", "--actor", "you"]);
  console.log(ac);
  const w = watchTickets(log);
  console.log(w);
  const t1 = board(p).tickets.get("checkout/01");
  expect(t1?.column).toBe("blocked");
  expect(t1?.reason).toContain("checkout-pay");
  expect(t1?.reason).toMatch(/body/);
  expect(board(p).tickets.get("checkout/02")?.column).toBe("building");
  expect(board(p).tickets.get("checkout/02")?.reason ?? "").not.toContain("checkout-pay");
});

test("29.5 new uncited card reports failed check, blocks nothing", async () => {
  const p = proj();
  await withTarget(p);
  writers(p);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  seed(p, [card("checkout-logout", "checkout")]);
  const w = watchTickets(join(p.dir, ".werk", "log.jsonl"));
  console.log(w);
  expect(w.failures.join("\n")).toContain("cards-cited");
  expect(w.failures.join("\n")).toContain("checkout-logout");
  expect([...board(p).tickets.values()].every((t) => t.column === "ready" && !t.reason)).toBe(true);
});
