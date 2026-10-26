import { expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentWerkArgv } from "../src/own/running.ts";
import type { Step } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

const all = (r: { out: string; err: string }) => r.out + r.err;

const spec = (stories: string[]) =>
  `# Spec: it\n\n## User stories\n\n${stories.map((s, i) => `${i + 1}. As a person, I want ${s}.`).join("\n")}\n\n## Test seams\n\nThe command line.\n`;

const ticket = (title: string, cites: string, blocked: string, stories: string, ac = "- It works.") =>
  `title: ${title}\ncites: ${cites}\nblocked_by: ${blocked}\nstories: ${stories}\ntouches: login\n\n## What to build\n\nA person does it.\n\n${ac === "" ? "" : `## Acceptance criteria\n\n${ac}\n\n`}## Checks\n\n- \`make test\`\n`;

type Ev = { type: string; payload: Record<string, unknown> };

function seedLog(p: Project, events: Ev[], actor = "you") {
  const file = join(p.dir, ".werk", "log.jsonl");
  const n = readFileSync(file, "utf8").split("\n").filter(Boolean).length;
  appendFileSync(file, `${events.map((e, i) => JSON.stringify({ seq: n + i + 1, at: "t", actor, ...e })).join("\n")}\n`);
}

/** Decided cards with every contract fact, so a later amend passes. */
function cards(p: Project, list: [string, string | undefined, string?][]) {
  const evs: Ev[] = [];
  for (const [id, parent, body] of list) {
    evs.push({ type: "node.added", payload: { id, kind: "card", title: `Card ${id}`, ...(body ? { body } : {}), ...(parent ? { parent } : {}) } });
  }
  for (const [id] of list) {
    evs.push({ type: "node.edited", payload: { id, who: "you", no_basis: "none", unchallenged: "none" } });
    evs.push({ type: "kill.added", payload: { id, criterion: { form: "revisit" } } });
    evs.push({ type: "node.decided", payload: { id } });
  }
  seedLog(p, evs);
}

async function withTarget(p: Project) {
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
}

const edit = (path: string, content: string): Step => ({ edit: { path, content } });
const answers = (sub: string, kind: "spec" | "ticket", list: unknown[] = []) =>
  edit(`.werk/specs/${sub}.${kind}-answers.json`, JSON.stringify(list));
const files = (sub: string, t: Record<string, string>) => Object.entries(t).map(([f, text]) => edit(`.werk/tickets/${sub}/${f}`, text));

const boardFile = (p: Project) => join(p.dir, ".werk", "board.jsonl");
const boardEvents = (p: Project) =>
  existsSync(boardFile(p))
    ? readFileSync(boardFile(p), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; payload: any; actor: string })
    : [];

/** The board as the events lead to it: id -> { column, archived, title, reason }. */
function board(p: Project) {
  const m = new Map<string, { column: string; archived: boolean; title: string; reason?: string }>();
  for (const e of boardEvents(p)) {
    const id = e.payload.id as string;
    if (e.type === "ticket.planned") {
      const prev = m.get(id);
      m.set(id, { column: prev?.column ?? (e.payload.blocked_by.length ? "blocked" : "ready"), archived: prev?.archived ?? false, title: e.payload.title, reason: prev?.reason });
    } else if (e.type === "ticket.moved") {
      const t = m.get(id);
      if (t) {
        t.column = e.payload.to;
        t.reason = e.payload.reason;
      }
    } else if (e.type === "ticket.archived") {
      const t = m.get(id);
      if (t) t.archived = true;
    } else if (e.type === "ticket.restored") {
      const t = m.get(id);
      if (t) t.archived = false;
    }
  }
  return m;
}

function basic(p: Project, over: { tickets?: Record<string, string>; sAnswers?: unknown[]; tAnswers?: unknown[] } = {}) {
  const t = over.tickets ?? {
    "01.md": ticket("Pay once", "checkout, checkout-pay", "", "1"),
    "02.md": ticket("Pay twice", "checkout", "1", "2"),
  };
  p.script({
    roles: {
      "spec-writer": { replies: [[edit(".werk/specs/checkout.md", spec(["to pay", "to retry"])), answers("checkout", "spec", over.sAnswers)]] },
      "ticket-writer": { replies: [[...files("checkout", t), answers("checkout", "ticket", over.tAnswers)]] },
    },
  });
}
const checkoutCards = (p: Project) =>
  cards(p, [
    ["checkout", undefined],
    ["checkout-pay", "checkout"],
  ]);

test("[28.1] a plan writes spec, tickets and ghost answers", async () => {
  const p = freshProject();
  checkoutCards(p);
  await withTarget(p);
  const ans = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Which ${slug}?`, body: "Body." });
  basic(p, { sAnswers: [ans("retry-limit")], tAnswers: [ans("ticket-order")] });
  const r = await p.werk(["plan", "checkout"]);
  console.log(all(r));
  expect(r.code).toBe(0);
  expect(existsSync(join(p.dir, ".werk", "specs", "checkout.md"))).toBe(true);
  const b = board(p);
  expect([...b.keys()].sort()).toEqual(["checkout/01", "checkout/02"]);
  for (const t of b.values()) expect(["ready", "blocked"]).toContain(t.column);
  for (const id of ["checkout-retry-limit", "checkout-ticket-order"]) {
    const s = await p.werk(["show", id]);
    console.log(s.out);
    expect(s.out.split("\n")[0]).toContain("proposed");
    expect(s.out).toContain("who: me");
    expect(s.out).toMatch(/parent: checkout\b/);
  }
  const types = boardEvents(p).map((e) => (e.type === "plan.step" ? `${e.type}:${e.payload.step}` : e.type));
  console.log(types);
  expect(types[0]).toBe("plan.started");
  expect(types).toContain("plan.step:spec writer");
  expect(types).toContain("plan.step:ticket writer");
  expect(types.at(-1)).toBe("plan.ended");
  for (const e of boardEvents(p).filter((e) => e.type === "plan.step" && e.payload.step !== "checks")) {
    expect(typeof e.payload.log).toBe("string");
    expect(existsSync(join(p.dir, ".werk", e.payload.log))).toBe(true);
  }
});

test("[28.2] an open card stops the plan before any writer", async () => {
  const p = freshProject();
  checkoutCards(p);
  seedLog(p, [{ type: "node.added", payload: { id: "checkout-draft", kind: "card", title: "Draft", parent: "checkout" } }]);
  await withTarget(p);
  basic(p);
  const r = await p.werk(["plan", "checkout"]);
  console.log(all(r));
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("checkout-draft");
  expect(p.launches()).toEqual([]);
  expect([...board(p).keys()]).toEqual([]);
});

test("[28.3] the writers see the cards the subtree rests on", async () => {
  const p = freshProject();
  cards(p, [
    ["checkout", undefined],
    ["auth", undefined, undefined],
    ["auth-token", "auth"],
    ["auth-sso", "auth"],
    ["payments-api", undefined],
  ]);
  seedLog(p, [
    { type: "edge.added", payload: { from: "checkout", to: "payments-api", type: "depends_on", why: "pays" } },
    { type: "edge.added", payload: { from: "payments-api", to: "auth-token", type: "depends_on", why: "tokens" } },
  ]);
  await withTarget(p);
  p.script({
    roles: {
      "spec-writer": { replies: [[edit(".werk/specs/checkout.md", spec(["to pay"])), answers("checkout", "spec")]] },
      "ticket-writer": { replies: [[...files("checkout", { "01.md": ticket("Pay", "checkout, payments-api", "", "1") }), answers("checkout", "ticket")] ] },
    },
  });
  const r = await p.werk(["plan", "checkout"]);
  console.log(all(r));
  const ls = p.launches();
  expect(ls.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  const spc = ls[0]?.messages[0] as string;
  const tier2 = spc.indexOf("Tier two");
  expect(tier2).toBeGreaterThan(-1);
  const i = (s: string, x: string) => s.indexOf(x);
  expect(i(spc, "### #checkout ")).toBeGreaterThan(-1);
  expect(i(spc, "### #checkout ")).toBeLessThan(tier2);
  expect(i(spc, "### #payments-api")).toBeLessThan(tier2);
  expect(i(spc, "### #payments-api")).toBeGreaterThan(-1);
  expect(i(spc, "### #auth-token")).toBeGreaterThan(tier2);
  for (const l of ls) {
    const m = l.messages[0] as string;
    expect(m).not.toContain("auth-sso");
    expect(m).not.toContain("Card auth\n");
    expect(m).not.toMatch(/#auth\b(?!-)/);
  }
});

test("[28.4] a taken answer id fails the plan; a bad ticket stays off the board", async () => {
  const p = freshProject();
  checkoutCards(p);
  cards(p, [["checkout-retry-limit", "checkout"]]);
  await withTarget(p);
  basic(p, {
    sAnswers: [{ slug: "retry-limit", title: "A", why: "W?", body: "B" }],
    tickets: {
      "01.md": ticket("Pay once", "checkout, checkout-pay, checkout-retry-limit", "", "1"),
      "02.md": ticket("No acceptance", "checkout", "", "2", ""),
    },
  });
  const before = readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8");
  const r = await p.werk(["plan", "checkout"]);
  console.log(all(r));
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("checkout-retry-limit");
  const s = await p.werk(["search", "retry-limit"]);
  const mapNow = await p.werk(["show", "checkout"]);
  expect((mapNow.out.match(/refines\s+checkout-retry-limit/g) ?? []).length).toBe(1);
  const b = board(p);
  console.log([...b.entries()]);
  expect(b.has("checkout/01")).toBe(true);
  expect(["ready", "blocked"]).toContain(b.get("checkout/01")?.column ?? "");
  expect(b.has("checkout/02")).toBe(false);
});

test("[28.5] no target until the person sets a valid one", async () => {
  const p = freshProject();
  checkoutCards(p);
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).toBe(1);
  expect(all(r)).toContain("werk target");
  writeFileSync(join(p.dir, "plain.txt"), "x");
  const f = await p.werk(["target", join(p.dir, "plain.txt")]);
  console.log(all(f));
  expect(f.code).not.toBe(0);
  const none = await p.werk(["target"]);
  expect(none.code).not.toBe(0);
  expect(none.out).toBe("");
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  const ok = await p.werk(["target", p.target]);
  expect(ok.code).toBe(0);
  const shown = await p.werk(["target"]);
  expect(shown.code).toBe(0);
  expect(shown.out.trim()).toBe(p.target);
});

function twoPlans(p: Project, second: { stories: string[]; tickets: Record<string, string>; secondAnswers?: unknown[] }, first?: Record<string, string>) {
  const firstTickets = first ?? {
    "01.md": ticket("Ticket one", "checkout", "", "1"),
    "02.md": ticket("Ticket two", "checkout-pay", "1", "2"),
    "03.md": ticket("Ticket three", "checkout-pay", "", "2"),
  };
  p.script({
    roles: {
      "spec-writer": {
        replies: [
          [edit(".werk/specs/checkout.md", spec(["one", "two"])), answers("checkout", "spec")],
          [edit(".werk/specs/checkout.md", spec(second.stories)), answers("checkout", "spec")],
        ],
      },
      "ticket-writer": {
        replies: [
          [...files("checkout", firstTickets), answers("checkout", "ticket")],
          [...files("checkout", second.tickets), answers("checkout", "ticket")],
        ],
      },
    },
  });
}

const move = (p: Project, id: string, to: string) =>
  appendFileSync(boardFile(p), `${JSON.stringify({ seq: boardEvents(p).length + 1, at: new Date().toISOString(), actor: "agent", type: "ticket.moved", payload: { id, to } })}\n`);

test("[29.1] a second plan extends the spec and continues the numbers", async () => {
  const p = freshProject();
  checkoutCards(p);
  await withTarget(p);
  twoPlans(p, {
    stories: ["one", "two", "three"],
    tickets: {
      "01.md": ticket("Ticket one REWRITTEN", "checkout", "", "1"),
      "03.md": ticket("Ticket three rewritten", "checkout-pay, checkout-new", "", "2"),
      "04.md": ticket("Ticket four", "checkout-pay", "", "3"),
    },
  });
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  move(p, "checkout/01", "building");
  move(p, "checkout/02", "building");
  move(p, "checkout/02", "merging");
  move(p, "checkout/02", "done");
  cards(p, [["checkout-new", "checkout"]]);
  const r = await p.werk(["plan", "checkout"]);
  console.log(all(r));
  expect(r.code).toBe(0);
  const b = board(p);
  console.log([...b.entries()]);
  expect([...b.keys()].sort()).toEqual(["checkout/01", "checkout/02", "checkout/03", "checkout/04"]);
  expect(readFileSync(join(p.dir, ".werk", "specs", "checkout.md"), "utf8")).toContain("three");
  expect(b.get("checkout/03")?.title).toBe("Ticket three rewritten");
  expect(b.get("checkout/04")?.title).toBe("Ticket four");
  expect(b.get("checkout/01")?.column).toBe("building");
  expect(b.get("checkout/01")?.title).toBe("Ticket one");
  expect(b.get("checkout/02")?.column).toBe("done");
  expect(b.get("checkout/02")?.title).toBe("Ticket two");
});

test("[29.2] a ticket the new spec no longer needs is archived and restorable", async () => {
  const p = freshProject();
  checkoutCards(p);
  cards(p, [["checkout-extra", "checkout"]]);
  await withTarget(p);
  twoPlans(
    p,
    { stories: ["one"], tickets: { "01.md": ticket("Ticket one", "checkout, checkout-pay", "", "1") } },
    {
      "01.md": ticket("Ticket one", "checkout, checkout-pay", "", "1"),
      "02.md": ticket("Ticket two", "checkout-extra", "", "2"),
    },
  );
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  expect(board(p).get("checkout/02")?.archived).toBe(false);
  expect((await p.werk(["remove", "checkout-extra", "--actor", "you"])).code).toBe(0);
  const r = await p.werk(["plan", "checkout"]);
  console.log(all(r));
  expect(board(p).get("checkout/02")?.archived).toBe(true);
  const ar = boardEvents(p).find((e) => e.type === "ticket.archived");
  expect(ar?.payload.reason).toMatch(/no longer needs/);
  const rs = await p.werk(["ticket", "restore", "checkout/02"]);
  console.log(all(rs));
  expect(rs.code).toBe(0);
  expect(board(p).get("checkout/02")?.archived).toBe(false);
});

/** Starts `werk serve` in the project and gives its stderr. */
function serve(p: Project) {
  const proc = p.start([...currentWerkArgv(), "serve", "--port", "0"]);
  let err = "";
  void (async () => {
    for await (const chunk of proc.stderr) err += new TextDecoder().decode(chunk);
  })();
  return { err: () => err };
}
async function until(f: () => boolean, ms = 8000) {
  const t = Date.now();
  while (!f() && Date.now() - t < ms) await Bun.sleep(100);
}

async function planned(p: Project) {
  checkoutCards(p);
  await withTarget(p);
  twoPlans(
    p,
    { stories: ["one", "two"], tickets: { "02.md": ticket("Ticket two", "checkout-pay", "", "2") } },
    { "01.md": ticket("Ticket one", "checkout, checkout-pay", "", "1"), "02.md": ticket("Ticket two", "checkout-pay", "", "2") },
  );
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
}

async function amend(p: Project, id: string, args: string[]) {
  expect((await p.werk(["propose", id, ...args])).code).toBe(0);
  const a = await p.werk(["accept", id, "--actor", "you"]);
  console.log("amend:", all(a));
  expect(a.code).toBe(0);
}

test("[29.3] retitling a cited card blocks the ready ticket; a re-plan clears it", async () => {
  const p = freshProject();
  await planned(p);
  const s = serve(p);
  await amend(p, "checkout-pay", ["--title", "Pay with a new title"]);
  await until(() => board(p).get("checkout/01")?.column === "blocked");
  const t = board(p).get("checkout/01");
  console.log(t, s.err());
  expect(t?.column).toBe("blocked");
  expect(t?.reason).toContain("checkout-pay");
  expect(t?.reason).toMatch(/title/);
  const r = await p.werk(["plan", "checkout"]);
  console.log(all(r));
  const t2 = board(p).get("checkout/01");
  expect(t2?.column).not.toBe("blocked");
});

test("[29.4] a note blocks nothing; a body change blocks the ready ticket, not the building one", async () => {
  const p = freshProject();
  await planned(p);
  move(p, "checkout/02", "building");
  const s = serve(p);
  await Bun.sleep(1500);
  expect((await p.werk(["say", "checkout-pay", "a note"])).code).toBe(0);
  await Bun.sleep(1500);
  expect(board(p).get("checkout/01")?.column).toBe("ready");
  expect(board(p).get("checkout/01")?.reason).toBeUndefined();
  expect(board(p).get("checkout/02")?.column).toBe("building");
  await amend(p, "checkout-pay", ["--ops", JSON.stringify([{ tag: "new", new: "A new body paragraph." }])]);
  await until(() => board(p).get("checkout/01")?.column === "blocked");
  const t = board(p).get("checkout/01");
  console.log(t, s.err());
  expect(t?.column).toBe("blocked");
  expect(t?.reason).toContain("checkout-pay");
  expect(t?.reason).toMatch(/body/);
  expect(board(p).get("checkout/02")?.column).toBe("building");
  expect(board(p).get("checkout/02")?.reason ?? undefined).toBeUndefined();
});

test("[29.5] an uncited new card reports a failed check, blocks nothing", async () => {
  const p = freshProject();
  await planned(p);
  const s = serve(p);
  await Bun.sleep(1500);
  cards(p, [["checkout-newcard", "checkout"]]);
  await until(() => s.err().includes("checkout-newcard"));
  console.log(s.err());
  expect(s.err()).toContain("cards-cited");
  expect(s.err()).toContain("checkout-newcard");
  for (const t of board(p).values()) {
    expect(t.column).toBe("ready");
    expect(t.reason).toBeUndefined();
  }
});
