import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent, readBoard, readBoardLog } from "../src/board/log.ts";
import { boardPath, card, edit, ok, planProject, seed, serve, SPEC, SPEC3, ticketText, w, type Project } from "./h.ts";

const SPEC_13 = SPEC3.replace("2. As a person, I want to retry a payment.\n", "");
const T = (file: string, text: string) => edit(`.werk/tickets/checkout/${file}`, text);
const ans = (f: string) => edit(`.werk/specs/checkout.${f}-answers.json`, "[]");
const board = (p: Project) => readBoard(boardPath(p));

function twoReplies(p: Project, first: { spec: string; tickets: Record<string, string> }, second: { spec: string; tickets: Record<string, string> }) {
  const files = (t: Record<string, string>) => Object.entries(t).map(([f, x]) => T(f, x));
  p.script({
    roles: {
      "spec-writer": {
        replies: [
          [edit(".werk/specs/checkout.md", first.spec), ans("spec")],
          [edit(".werk/specs/checkout.md", second.spec), ans("spec")],
        ],
      },
      "ticket-writer": { replies: [[...files(first.tickets), ans("ticket")], [...files(second.tickets), ans("ticket")]] },
    },
  });
}

const FIRST = {
  "01.md": ticketText("Pay", "checkout, checkout-cart", "", "1"),
  "02.md": ticketText("Retry", "checkout-pay", "", "2"),
  "03.md": ticketText("Receipt text", "checkout", "1", "2"),
};

test("29.1 a second plan extends spec, continues numbers, leaves closed tickets alone", async () => {
  const p = await planProject();
  twoReplies(p, { spec: SPEC, tickets: FIRST }, {
    spec: SPEC3,
    tickets: {
      "01.md": ticketText("Pay REWRITTEN", "checkout, checkout-cart", "", "1"),
      "02.md": ticketText("Retry REWRITTEN", "checkout-pay", "", "2"),
      "03.md": ticketText("Receipt rewritten", "checkout, checkout-receipt", "1", "2, 3"),
      "04.md": ticketText("Fourth", "checkout-receipt", "1", "3"),
    },
  });
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  expect([...board(p).tickets.keys()]).toEqual(["checkout/01", "checkout/02", "checkout/03"]);
  expect([...board(p).tickets.values()].map((t) => t.column)).toEqual(["ready", "ready", "ready"]);
  for (const to of ["building"] as const) expect(appendBoardEvent(boardPath(p), "ticket.moved", { id: "checkout/01", to }).ok).toBe(true);
  for (const to of ["building", "merging", "done"] as const) expect(appendBoardEvent(boardPath(p), "ticket.moved", { id: "checkout/02", to }).ok).toBe(true);
  seed(p, [card("checkout-receipt", "Receipt", { status: "decided", parent: "checkout" })]);
  const r = await p.werk(["plan", "checkout"]);
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  const b = board(p);
  const specs = [...new Bun.Glob("*.md").scanSync(join(p.dir, ".werk", "specs"))];
  expect(specs).toEqual(["checkout.md"]);
  expect(readFileSync(join(p.dir, ".werk", "specs", "checkout.md"), "utf8")).toBe(SPEC3);
  expect(b.tickets.get("checkout/03")?.title).toBe("Receipt rewritten");
  expect(b.tickets.get("checkout/04")?.title).toBe("Fourth");
  expect([...b.tickets.keys()]).toEqual(["checkout/01", "checkout/02", "checkout/03", "checkout/04"]);
  expect(b.tickets.get("checkout/01")).toMatchObject({ column: "building", title: "Pay" });
  expect(b.tickets.get("checkout/02")).toMatchObject({ column: "done", title: "Retry" });
});

test("29.2 an open ticket the new spec no longer needs is archived; restore brings it back", async () => {
  const p = await planProject();
  twoReplies(p, { spec: SPEC, tickets: { "01.md": ticketText("Pay", "checkout, checkout-cart", "", "1"), "02.md": ticketText("Retry", "checkout-pay", "1", "2") } }, {
    spec: SPEC_13,
    tickets: { "03.md": ticketText("Receipt", "checkout, checkout-cart", "", "3") },
  });
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  await ok(p, "remove", "checkout-pay", "--actor", "you");
  const r = await p.werk(["plan", "checkout"]);
  expect(r.err).toBe("");
  expect(board(p).tickets.get("checkout/02")).toMatchObject({ archived: true });
  const arch = readBoardLog(boardPath(p)).events.find((e) => e.type === "ticket.archived");
  expect((arch?.payload as { reason?: string }).reason).toBe("the current spec of #checkout no longer needs it");
  expect((await p.werk(["ticket", "restore", "checkout/02"])).code).toBe(0);
  expect(board(p).tickets.get("checkout/02")).toMatchObject({ archived: false, column: "ready" });
});

async function until<T>(f: () => T | undefined, ms = 8000): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined || Date.now() > end) return v;
    await Bun.sleep(100);
  }
}

test("29.3 retitling a cited card blocks the ready ticket; a re-plan clears it", async () => {
  const p = await planProject();
  twoReplies(p, { spec: SPEC, tickets: { "01.md": ticketText("Pay", "checkout, checkout-cart", "", "1"), "02.md": ticketText("Retry", "checkout-pay", "1", "2") } }, {
    spec: SPEC,
    tickets: { "01.md": ticketText("Pay", "checkout, checkout-cart", "", "1"), "02.md": ticketText("Retry", "checkout-pay", "1", "2") },
  });
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  await serve(p);
  await ok(p, "propose", "checkout-pay", "--title", "Card pay, renamed");
  await ok(p, "accept", "checkout-pay", "--actor", "you");
  const blocked = await until(() => (board(p).tickets.get("checkout/02")?.column === "blocked" ? board(p).tickets.get("checkout/02") : undefined));
  expect(blocked?.column).toBe("blocked");
  expect(blocked?.reason).toContain("checkout-pay");
  expect(blocked?.reason).toContain("title");
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  const t = board(p).tickets.get("checkout/02");
  expect(t?.column).toBe("ready");
  const second = p.launches().filter((l) => l.role === "ticket-writer")[1]?.messages[0] as string;
  expect(second).toContain("Card pay, renamed");
});

test("29.4 a note blocks nothing, a building ticket is never blocked", async () => {
  const p = await planProject();
  twoReplies(p, { spec: SPEC, tickets: { "01.md": ticketText("Pay", "checkout, checkout-cart, checkout-pay", "", "1"), "02.md": ticketText("Retry", "checkout-pay", "1", "2") } }, { spec: SPEC, tickets: {} });
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  expect(appendBoardEvent(boardPath(p), "ticket.moved", { id: "checkout/01", to: "building" }).ok).toBe(true);
  const s = await serve(p);
  await ok(p, "say", "checkout-pay", "Is this still right?");
  await Bun.sleep(1500);
  expect(board(p).tickets.get("checkout/02")?.column).toBe("ready");
  expect(board(p).tickets.get("checkout/02")?.reason).toBeUndefined();
  expect(board(p).tickets.get("checkout/01")?.column).toBe("building");
  await ok(p, "edit", "checkout-pay", "--body", "x").catch(() => undefined);
  await ok(p, "propose", "checkout-pay", "--ops", JSON.stringify([{ tag: "new", new: "A changed body." }]));
  await ok(p, "accept", "checkout-pay", "--actor", "you");
  const blocked = await until(() => (board(p).tickets.get("checkout/02")?.column === "blocked" ? board(p).tickets.get("checkout/02") : undefined));
  expect(blocked?.reason).toContain("checkout-pay");
  expect(blocked?.reason).toContain("body");
  expect(board(p).tickets.get("checkout/01")?.column).toBe("building");
  expect(board(p).tickets.get("checkout/01")?.reason).toBeUndefined();
  void s;
});

test("29.5 a card added under a planned subtree reports a failed cards-cited check", async () => {
  const p = await planProject();
  twoReplies(p, { spec: SPEC, tickets: { "01.md": ticketText("Pay", "checkout, checkout-cart, checkout-pay", "", "1, 2") } }, { spec: SPEC, tickets: {} });
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  const s = await serve(p);
  seed(p, [
    card("checkout-new", "New card", { status: "decided", parent: "checkout", who: "me", no_basis: "x", unchallenged: "x" }),
    { type: "kill.added", payload: { id: "checkout-new", criterion: { form: "revisit" } } },
  ]);
  await Bun.sleep(1500);
  const err = s.err();
  expect(err).toContain("cards-cited");
  expect(err).toContain("checkout-new");
  for (const t of board(p).tickets.values()) {
    expect(t.column).toBe("ready");
    expect(t.reason).toBeUndefined();
  }
  void w;
});
