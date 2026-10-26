import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard, readBoardLog } from "../src/board/log.ts";
import { boardPath, card, edit, freshProject, ok, planProject, seed, SPEC, ticketText, w, withRoot, type Project } from "./h.ts";

const GOOD = {
  "01.md": ticketText("Pay", "checkout, checkout-cart", "", "1"),
  "02.md": ticketText("Retry", "checkout-pay", "1", "2"),
};

function writers(p: Project, o: { tickets?: Record<string, string>; specAnswers?: object[]; ticketAnswers?: object[] } = {}) {
  p.script({
    roles: {
      "spec-writer": {
        replies: [[edit(".werk/specs/checkout.md", SPEC), edit(".werk/specs/checkout.spec-answers.json", JSON.stringify(o.specAnswers ?? []))]],
      },
      "ticket-writer": {
        replies: [
          [
            ...Object.entries(o.tickets ?? GOOD).map(([f, t]) => edit(`.werk/tickets/checkout/${f}`, t)),
            edit(".werk/specs/checkout.ticket-answers.json", JSON.stringify(o.ticketAnswers ?? [])),
          ],
        ],
      },
    },
  });
}
const answer = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Which ${slug}?`, body: "Body." });

test("28.1 plan over a decided subtree", async () => {
  const p = await planProject();
  writers(p, { specAnswers: [answer("retry-limit")], ticketAnswers: [answer("ticket-order")] });
  const r = await p.werk(["plan", "checkout"]);
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(existsSync(join(p.dir, ".werk", "specs", "checkout.md"))).toBe(true);
  const b = readBoard(boardPath(p));
  expect([...b.tickets.keys()]).toEqual(["checkout/01", "checkout/02"]);
  for (const t of b.tickets.values()) expect(["ready", "blocked"]).toContain(t.column);
  for (const id of ["checkout-retry-limit", "checkout-ticket-order"]) {
    const s = (await ok(p, "show", id)).out;
    expect(s.split("\n")[0]).toContain("proposed");
    expect(s).toContain("parent: checkout");
    expect(s).toContain("who: me");
  }
  const ev = readBoardLog(boardPath(p)).events;
  const types = ev.map((e) => [e.type, (e.payload as { step?: string }).step ?? ""].join(":"));
  expect(types).toContain("plan.started:");
  expect(types).toContain("plan.step:spec writer");
  expect(types).toContain("plan.step:ticket writer");
  expect(types.at(-1)).toBe("plan.ended:");
  for (const e of ev.filter((e) => e.type === "plan.step" && (e.payload as { step: string }).step !== "checks"))
    expect(existsSync(join(p.dir, ".werk", (e.payload as { log: string }).log))).toBe(true);
});

test("28.2 an open card stops the plan before any writer runs", async () => {
  const p = await planProject([card("checkout-draft", "Draft", { parent: "checkout" })]);
  writers(p);
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("checkout-draft");
  expect(p.launches()).toEqual([]);
  expect(readBoard(boardPath(p)).tickets.size).toBe(0);
});

test("28.3 writers see the cards the subtree rests on, not those beside them", async () => {
  const p = withRoot();
  const d = (id: string, parent: string) => card(id, `Card ${id}`, { status: "decided", parent });
  seed(p, [
    d("checkout", "root"),
    d("payments", "root"),
    d("payments-api", "payments"),
    d("auth", "root"),
    d("auth-token", "auth"),
    d("auth-sso", "auth"),
    { type: "edge.added", payload: { from: "checkout", to: "payments-api", type: "depends_on", why: "pays" } },
    { type: "edge.added", payload: { from: "payments-api", to: "auth-token", type: "depends_on", why: "auth" } },
  ]);
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  await ok(p, "target", p.target);
  writers(p, { tickets: { "01.md": ticketText("Pay", "checkout", "", "1"), "02.md": ticketText("Retry", "checkout", "1", "2") } });
  await p.werk(["plan", "checkout"]);
  const launches = p.launches();
  expect(launches.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  for (const l of launches) {
    const prompt = l.messages[0] as string;
    const t2 = prompt.indexOf("## Tier two");
    expect(t2).toBeGreaterThan(-1);
    expect(prompt.indexOf("### #checkout")).toBeGreaterThan(-1);
    expect(prompt.indexOf("### #checkout")).toBeLessThan(t2);
    expect(prompt.indexOf("### #payments-api")).toBeGreaterThan(-1);
    expect(prompt.indexOf("### #payments-api")).toBeLessThan(t2);
    expect(prompt.indexOf("### #auth-token")).toBeGreaterThan(t2);
    expect(prompt).not.toContain("auth-sso");
    expect(prompt).not.toMatch(/#auth\b(?!-)/);
  }
  const sys = (l: { args: string[] }) => l.args.join("\n");
  const first = (l: { args: string[] }) => sys(l).indexOf("You are the");
  expect(sys(launches[0] as { args: string[] })).toContain("You are the spec writer");
  expect(sys(launches[1] as { args: string[] })).toContain("You are the ticket writer");
  // the role text comes first in the system prompt, before the werk instructions
  for (const l of launches) expect(sys(l).indexOf("You are the")).toBeLessThan(sys(l).indexOf("werk — how to work with the decision map"));
  void first;
});

test("28.4 a taken answer id fails the plan; a bad ticket stays off the board", async () => {
  const p = await planProject([card("checkout-retry-limit", "Taken", { status: "decided", parent: "checkout" })]);
  writers(p, {
    specAnswers: [answer("retry-limit")],
    tickets: {
      "01.md": ticketText("Pay", "checkout, checkout-cart, checkout-pay, checkout-retry-limit", "", "1, 2"),
      "02.md": ticketText("Bad", "checkout", "", "2").replace("- It works.", ""),
    },
  });
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("checkout-retry-limit");
  const s = (await ok(p, "show", "checkout-retry-limit")).out;
  expect(s).toContain("Taken");
  const b = readBoard(boardPath(p));
  expect(b.tickets.has("checkout/01")).toBe(true);
  expect(["ready", "blocked"]).toContain(b.tickets.get("checkout/01")?.column);
  expect(b.tickets.has("checkout/02")).toBe(false);
});

test("28.5 target needs a valid path", async () => {
  const p = withRoot();
  seed(p, [card("checkout", "Checkout", { status: "decided", parent: "root" })]);
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("werk target");
  const file = join(p.dir, "plain.txt");
  writeFileSync(file, "x");
  const bad = await p.werk(["target", file]);
  expect(bad.code).not.toBe(0);
  expect((await p.werk(["target"])).code).not.toBe(0);
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
  const out = await p.werk(["target"]);
  expect(out.code).toBe(0);
  expect(out.out.trim()).toBe(p.target);
  void freshProject;
  void w;
});
