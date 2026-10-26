import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent } from "../src/board/log.ts";
import type { Project } from "../src/test/project.ts";
import { board, boardFile, decidedCard, makeProject, observe, serve, spec, ticket, withTarget, writers } from "./d-plan-helpers.ts";

const base = () => [
  { type: "node.added", payload: { id: "root", kind: "card", title: "Root" } },
  ...decidedCard("checkout", "root"),
  ...decidedCard("checkout-pay", "checkout"),
  ...decidedCard("checkout-receipt", "checkout"),
  ...decidedCard("checkout-ship", "checkout"),
];
const t1 = ticket({ title: "Pay", cites: "checkout, checkout-pay", stories: "1" });
const t2 = ticket({ title: "Receipt", cites: "checkout-pay, checkout-receipt", stories: "2" });
const t3 = ticket({ title: "Ship", cites: "checkout-ship", stories: "3" });
const ticketsDir = (p: Project) => join(p.dir, ".werk", "tickets", "checkout");
const col = (p: Project, id: string) => board(p).tickets.get(id);

/** The person adds a decided card through the command line: a ghost with every fact, accepted. */
async function addDecided(p: Project, id: string, title: string) {
  const steps = [
    ["add", id, "--title", title, "--body", `Body of ${title}.`, "--parent", "checkout", "--who", "you"],
    ["edit", id, "--no-basis", "first", "--unchallenged", "none"],
    ["kill", id, "--revisit"],
    ["status", id, "decided"],
    ["accept", id, "--actor", "you"],
  ];
  for (const s of steps) {
    const r = await p.werk(s);
    if (r.code !== 0) throw new Error(`werk ${s.join(" ")}: ${r.err}${r.out}`);
  }
}

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  const p = makeProject(base());
  await withTarget(p);
  writers(p, "checkout", [
    { spec: spec("checkout", [1, 2, 3]), tickets: { "01.md": t1, "02.md": t2, "03.md": t3 } },
    {
      spec: `${spec("checkout", [1, 2, 3, 4])}\nStory 4 covers the refund card.\n`,
      tickets: {
        "03.md": ticket({ title: "Ship, rewritten", cites: "checkout-ship", stories: "3", build: "A person ships the order, rewritten." }),
        "04.md": ticket({ title: "Refund", cites: "checkout-refund", stories: "4" }),
      },
    },
  ]);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  for (const id of ["checkout/01", "checkout/02", "checkout/03"]) expect(col(p, id)?.column).toBe("ready");
  const bf = boardFile(p);
  expect(appendBoardEvent(bf, "ticket.moved", { id: "checkout/01", to: "building" }).ok).toBe(true);
  for (const to of ["building", "merging", "done"] as const) expect(appendBoardEvent(bf, "ticket.moved", { id: "checkout/02", to }).ok).toBe(true);
  const text1 = readFileSync(join(ticketsDir(p), "01.md"), "utf8");
  const text2 = readFileSync(join(ticketsDir(p), "02.md"), "utf8");
  await addDecided(p, "checkout-refund", "Refund a payment");
  const r = await p.werk(["plan", "checkout"]);
  console.log(r.code, r.out, r.err);
  const specs = readdirSync(join(p.dir, ".werk", "specs")).filter((f) => f.endsWith(".md"));
  expect(specs).toEqual(["checkout.md"]);
  const specPrompt = p.launches().filter((l) => l.role === "spec-writer")[1]?.messages[0] as string;
  expect(specPrompt).toContain("#checkout-refund");
  expect(readFileSync(join(p.dir, ".werk", "specs", "checkout.md"), "utf8")).toContain("refund");
  const ticketPrompt = p.launches().filter((l) => l.role === "ticket-writer")[1]?.messages[0] as string;
  console.log(ticketPrompt.split("\n").filter((l) => /number|Number|0[1-4]/.test(l)).join("\n"));
  expect(ticketPrompt).toMatch(/after 03/);
  const b = board(p);
  expect(b.tickets.get("checkout/03")).toMatchObject({ title: "Ship, rewritten", archived: false });
  expect(b.tickets.get("checkout/04")?.archived).toBe(false);
  expect(["ready", "blocked"]).toContain(b.tickets.get("checkout/04")?.column ?? "none");
  const ids = [...b.tickets.keys()];
  expect(new Set(ids).size).toBe(ids.length);
  expect(b.tickets.get("checkout/01")).toMatchObject({ column: "building", title: "Pay" });
  expect(b.tickets.get("checkout/02")).toMatchObject({ column: "done", title: "Receipt" });
  expect(readFileSync(join(ticketsDir(p), "01.md"), "utf8")).toBe(text1);
  expect(readFileSync(join(ticketsDir(p), "02.md"), "utf8")).toBe(text2);
  expect(r.code).toBe(0);
}, 90000);

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  const p = makeProject(base());
  await withTarget(p);
  writers(p, "checkout", [
    { spec: spec("checkout", [1, 2, 3]), tickets: { "01.md": t1, "02.md": ticket({ title: "Receipt", cites: "checkout-receipt", stories: "2" }), "03.md": t3 } },
    { spec: spec("checkout", [1, 3]), tickets: {} },
  ]);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  expect(col(p, "checkout/02")?.column).toBe("ready");
  const rm = await p.werk(["remove", "checkout-receipt", "--actor", "you"]);
  expect(rm.code).toBe(0);
  const r = await p.werk(["plan", "checkout"]);
  console.log(r.code, r.out, r.err);
  const t = col(p, "checkout/02");
  console.log(JSON.stringify(t));
  expect(t?.archived).toBe(true);
  expect(t?.archiveReason ?? "").toMatch(/no longer needs/);
  const rs = await p.werk(["ticket", "restore", "checkout/02", "--actor", "you"]);
  console.log(rs.code, rs.out, rs.err);
  expect(rs.code).toBe(0);
  expect(col(p, "checkout/02")).toMatchObject({ id: "checkout/02", archived: false });
}, 90000);

test("29.3 retitling a cited card blocks the ready ticket, and a re-plan clears it", async () => {
  const p = makeProject(base());
  await withTarget(p);
  writers(p, "checkout", [
    { spec: spec("checkout", [1, 2, 3]), tickets: { "01.md": t1, "02.md": t2, "03.md": t3 } },
    {
      spec: spec("checkout", [1, 2, 3]),
      tickets: { "02.md": ticket({ title: "Receipt", cites: "checkout-pay, checkout-receipt", stories: "2", build: "Show the receipt per Receipt mails at once." }) },
    },
  ]);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  const srv = await serve(p);
  try {
    expect((await p.werk(["propose", "checkout-receipt", "--title", "Receipt mails at once"])).code).toBe(0);
    expect((await p.werk(["accept", "checkout-receipt", "--actor", "you"])).code).toBe(0);
    const t = await observe(() => col(p, "checkout/02"), (v) => v?.column === "blocked");
    console.log(JSON.stringify(t), srv.err());
    expect(t?.column).toBe("blocked");
    expect(t?.reason ?? "").toContain("#checkout-receipt");
    expect(t?.reason ?? "").toContain("new title");
    const r = await p.werk(["plan", "checkout"]);
    console.log(r.code, r.out, r.err);
    const prompt = p.launches().filter((l) => l.role === "ticket-writer")[1]?.messages[0] as string;
    expect(prompt).toContain("Receipt mails at once");
    const after = col(p, "checkout/02");
    console.log(JSON.stringify(after));
    expect(after?.column).toBe("ready");
    expect(readFileSync(join(ticketsDir(p), "02.md"), "utf8")).toContain("Receipt mails at once");
  } finally {
    srv.stop();
  }
}, 90000);

test("29.4 a note blocks nothing, and a building ticket is never blocked", async () => {
  const p = makeProject(base());
  await withTarget(p);
  writers(p, "checkout", [{ spec: spec("checkout", [1, 2, 3]), tickets: { "01.md": t1, "02.md": t2, "03.md": t3 } }]);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  expect(appendBoardEvent(boardFile(p), "ticket.moved", { id: "checkout/01", to: "building" }).ok).toBe(true);
  const srv = await serve(p);
  try {
    expect((await p.werk(["say", "checkout-pay", "Is the amount right?"])).code).toBe(0);
    await Bun.sleep(1500);
    expect(col(p, "checkout/02")).toMatchObject({ column: "ready" });
    expect(col(p, "checkout/02")?.reason).toBeUndefined();
    expect(col(p, "checkout/01")).toMatchObject({ column: "building" });
    expect(col(p, "checkout/01")?.reason).toBeUndefined();
    const ops = JSON.stringify([{ tag: "elaborated", old: "Body of checkout-pay.", new: "Body of checkout-pay, now in two steps." }]);
    const pr = await p.werk(["propose", "checkout-pay", "--ops", ops]);
    expect(pr.code).toBe(0);
    expect((await p.werk(["accept", "checkout-pay", "--actor", "you"])).code).toBe(0);
    const t = await observe(() => col(p, "checkout/02"), (v) => v?.column === "blocked");
    console.log(JSON.stringify(t), JSON.stringify(col(p, "checkout/01")));
    expect(t?.column).toBe("blocked");
    expect(t?.reason ?? "").toContain("#checkout-pay");
    expect(t?.reason ?? "").toContain("new body");
    expect(col(p, "checkout/01")?.column).toBe("building");
    expect(col(p, "checkout/01")?.reason).toBeUndefined();
  } finally {
    srv.stop();
  }
}, 90000);

test("29.5 a card added under a planned subtree reports a failed check without blocking", async () => {
  const p = makeProject(base());
  await withTarget(p);
  writers(p, "checkout", [{ spec: spec("checkout", [1, 2, 3]), tickets: { "01.md": t1, "02.md": t2, "03.md": t3 } }]);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  const srv = await serve(p);
  try {
    await addDecided(p, "checkout-gift", "Gift wrap an order");
    const err = await observe(() => srv.err(), (e) => e.includes("checkout-gift"));
    console.log(err);
    expect(err).toContain("cards-cited");
    expect(err).toContain("#checkout-gift");
    for (const id of ["checkout/01", "checkout/02", "checkout/03"]) {
      expect(col(p, id)?.column).toBe("ready");
      expect(col(p, id)?.reason).toBeUndefined();
    }
  } finally {
    srv.stop();
  }
}, 90000);
