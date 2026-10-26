import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject } from "../src/test/project.ts";
import { SPEC_WRITER_BASE, TICKET_WRITER_BASE } from "../src/plan/prompts.ts";
import { board, boardEvents, decidedCard, makeProject, spec, ticket, withTarget, writers } from "./d-plan-helpers.ts";

const base = () => [
  { type: "node.added", payload: { id: "root", kind: "card", title: "Root" } },
  ...decidedCard("checkout", "root"),
  ...decidedCard("checkout-pay", "checkout"),
  ...decidedCard("checkout-receipt", "checkout"),
];
const answer = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Why ${slug}?`, body: `Body ${slug}.` });
const goodTickets = {
  "01.md": ticket({ title: "Pay", cites: "checkout, checkout-pay", stories: "1" }),
  "02.md": ticket({ title: "Receipt", cites: "checkout-receipt", blocked: "1", stories: "2" }),
};

test("28.1 a plan writes a spec, puts tickets on the board, and proposes answers as ghosts", async () => {
  const p = makeProject(base());
  await withTarget(p);
  writers(p, "checkout", [
    { spec: spec("checkout", [1, 2]), specAnswers: [answer("retry-limit")], tickets: goodTickets, ticketAnswers: [answer("ticket-order")] },
  ]);
  const r = await p.werk(["plan", "checkout"]);
  console.log(r.code, r.out, r.err);
  expect(r.code).toBe(0);
  expect(existsSync(join(p.dir, ".werk", "specs", "checkout.md"))).toBe(true);
  const b = board(p);
  for (const id of ["checkout/01", "checkout/02"]) expect(["ready", "blocked"]).toContain(b.tickets.get(id)?.column ?? "none");
  for (const id of ["checkout-retry-limit", "checkout-ticket-order"]) {
    const s = await p.werk(["show", id]);
    console.log(s.out);
    expect(s.out.split("\n")[0]).toContain("proposed");
    expect(s.out).toMatch(/parent: checkout\b/);
    expect(s.out).toMatch(/who: me/);
  }
  const ev = boardEvents(p).map((e) => [e.type, (e.payload as { step?: string; log?: string }).step ?? "", (e.payload as { log?: string }).log ?? ""]);
  console.log(JSON.stringify(ev));
  expect(ev[0]?.[0]).toBe("plan.started");
  const specStep = ev.find((e) => e[0] === "plan.step" && e[1] === "spec writer");
  const ticketStep = ev.find((e) => e[0] === "plan.step" && e[1] === "ticket writer");
  expect(specStep?.[2]).toBeTruthy();
  expect(ticketStep?.[2]).toBeTruthy();
  expect(existsSync(join(p.dir, ".werk", specStep?.[2] as string))).toBe(true);
  expect(existsSync(join(p.dir, ".werk", ticketStep?.[2] as string))).toBe(true);
  expect(ev.at(-1)?.[0]).toBe("plan.ended");
}, 60000);

test("28.2 an open card in the subtree stops the plan before any writer runs", async () => {
  const p = makeProject([
    ...base(),
    { type: "node.added", payload: { id: "checkout-draft", kind: "card", title: "Draft", parent: "checkout" } },
  ]);
  await withTarget(p);
  writers(p, "checkout", [{ spec: spec("checkout", [1, 2]), tickets: goodTickets }]);
  const r = await p.werk(["plan", "checkout"]);
  console.log(r.code, r.out, r.err);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("checkout-draft");
  expect(p.launches()).toEqual([]);
  expect([...board(p).tickets.keys()].filter((k) => k.startsWith("checkout/"))).toEqual([]);
}, 60000);

test("28.3 writers see the decided cards the subtree rests on, not those beside them", async () => {
  const p = makeProject([
    { type: "node.added", payload: { id: "root", kind: "card", title: "Root" } },
    ...decidedCard("auth", "root"),
    ...decidedCard("auth-token", "auth"),
    ...decidedCard("auth-sso", "auth"),
    ...decidedCard("payments-api", "root"),
    ...decidedCard("checkout", "root"),
    { type: "edge.added", payload: { from: "checkout", to: "payments-api", type: "depends_on", why: "charges through it" } },
    { type: "edge.added", payload: { from: "payments-api", to: "auth-token", type: "depends_on", why: "signs calls" } },
  ]);
  await withTarget(p);
  writers(p, "checkout", [{ spec: spec("checkout", [1]), tickets: { "01.md": ticket({ title: "Pay", cites: "checkout, payments-api", stories: "1" }) } }]);
  const r = await p.werk(["plan", "checkout"]);
  console.log(r.code, r.out, r.err);
  const launches = p.launches();
  expect(launches.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  const specPrompt = launches[0]?.messages[0] as string;
  console.log(specPrompt);
  const t1 = specPrompt.indexOf("Tier one");
  const t2 = specPrompt.indexOf("Tier two");
  expect(t1).toBeGreaterThanOrEqual(0);
  expect(t2).toBeGreaterThan(t1);
  const first = specPrompt.slice(t1, t2);
  const second = specPrompt.slice(t2);
  expect(first).toContain("#checkout");
  expect(first).toContain("#payments-api");
  expect(second).toContain("#auth-token");
  expect(first).not.toContain("### #auth-token");
  expect(second).toContain("### #auth-token");
  for (const l of launches) {
    const prompt = l.messages[0] as string;
    expect(prompt).not.toContain("auth-sso");
    expect(prompt).not.toMatch(/#auth\b(?!-)/);
  }
  expect(launches[0]?.args.join(" ")).toContain(SPEC_WRITER_BASE);
  expect(launches[1]?.args.join(" ")).toContain(TICKET_WRITER_BASE);
  expect(launches[0]?.args.join(" ")).not.toContain(TICKET_WRITER_BASE);
}, 60000);

test("28.4 a taken answer id fails the plan, and a bad ticket stays off the board", async () => {
  const p = makeProject([...base(), ...decidedCard("checkout-retry-limit", "checkout")]);
  await withTarget(p);
  writers(p, "checkout", [
    {
      spec: spec("checkout", [1, 2]),
      specAnswers: [answer("retry-limit")],
      tickets: {
        "01.md": ticket({ title: "Pay", cites: "checkout, checkout-pay, checkout-receipt, checkout-retry-limit", stories: "1, 2" }),
        "02.md": ticket({ title: "No criteria", cites: "checkout-receipt", stories: "2", acceptance: false }),
      },
    },
  ]);
  const before = readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter((l) => l.includes('"checkout-retry-limit"') && l.includes("node.")).length;
  const r = await p.werk(["plan", "checkout"]);
  console.log(r.code, r.out, r.err);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("checkout-retry-limit");
  const after = readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter((l) => l.includes('"id":"checkout-retry-limit"') && /node\.(added|proposed)/.test(l)).length;
  expect(after).toBe(1);
  expect(before).toBeGreaterThanOrEqual(1);
  const b = board(p);
  expect(["ready", "blocked"]).toContain(b.tickets.get("checkout/01")?.column ?? "none");
  expect(b.tickets.has("checkout/02")).toBe(false);
}, 60000);

test("28.5 a project with no target cannot plan until a valid target is set", async () => {
  const p = makeProject(base());
  writers(p, "checkout", [{ spec: spec("checkout", [1, 2]), tickets: goodTickets }]);
  const r = await p.werk(["plan", "checkout"]);
  console.log(r.code, r.err);
  expect(r.code).toBe(1);
  expect(r.err).toContain("werk target");
  const file = join(p.dir, "plain.txt");
  writeFileSync(file, "x");
  const bad = await p.werk(["target", file]);
  console.log(bad.code, bad.err);
  expect(bad.code).not.toBe(0);
  expect((await p.werk(["target"])).code).not.toBe(0);
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
  const show = await p.werk(["target"]);
  console.log(show.out);
  expect(show.code).toBe(0);
  expect(show.out.trim()).toBe(p.target);
}, 60000);
void freshProject;
