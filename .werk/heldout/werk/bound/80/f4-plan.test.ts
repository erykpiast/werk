import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { board, boardEvents, edit, join, proj, readFileSync, SPEC, ticket, withTarget } from "./f4-plan-lib.ts";

const answer = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Which ${slug}?`, body: "The body." });
const TICKETS = {
  "01.md": ticket("Pay", "checkout", "", "1"),
  "02.md": ticket("Retry", "checkout", "1", "2"),
};
function writers(p: any, o: { tickets?: Record<string, string>; sa?: unknown[]; ta?: unknown[]; slug?: string } = {}) {
  p.script({
    roles: {
      "spec-writer": {
        replies: [[edit(".werk/specs/checkout.md", SPEC), edit(".werk/specs/checkout.spec-answers.json", JSON.stringify(o.sa ?? []))]],
      },
      "ticket-writer": {
        replies: [
          [
            ...Object.entries(o.tickets ?? TICKETS).map(([f, t]) => edit(`.werk/tickets/checkout/${f}`, t)),
            edit(".werk/specs/checkout.ticket-answers.json", JSON.stringify(o.ta ?? [])),
          ],
        ],
      },
    },
  });
}

test("28.1 plan over decided subtree", async () => {
  const p = proj([["checkout", undefined]]);
  await withTarget(p);
  writers(p, { sa: [answer("retry-limit")], ta: [answer("ticket-order")] });
  const run = await p.werk(["plan", "checkout"]);
  expect(run.code).toBe(0);
  expect(existsSync(join(p.dir, ".werk", "specs", "checkout.md"))).toBe(true);
  const b = board(p);
  expect([...b.tickets.values()].map((t) => [t.id, t.column])).toEqual([
    ["checkout/01", "ready"],
    ["checkout/02", "ready"],
  ]);
  for (const id of ["checkout-retry-limit", "checkout-ticket-order"]) {
    const s = await p.werk(["show", id]);
    expect(s.out).toContain("proposed");
    expect(s.out).toContain("checkout");
    console.log(s.out);
  }
  const ev = boardEvents(p);
  expect(ev.map((e) => e.type)).toContain("plan.started");
  expect(ev.filter((e) => e.type === "plan.step").map((e: any) => e.payload.step)).toEqual(["spec writer", "ticket writer", "checks"]);
  expect(ev.filter((e: any) => e.type === "plan.step" && e.payload.step !== "checks").every((e: any) => e.payload.log)).toBe(true);
  expect(ev.at(-1)?.type).toBe("plan.ended");
  const log = readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8");
  console.log(log.split("\n").filter((l) => l.includes("checkout-retry-limit")).join("\n"));
});

test("28.2 open card stops plan", async () => {
  const p = proj([["checkout", undefined]], [{ type: "node.added", payload: { id: "child", kind: "card", title: "Child", parent: "checkout" } }]);
  await withTarget(p);
  writers(p);
  const run = await p.werk(["plan", "checkout"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("child");
  expect(p.launches()).toEqual([]);
  expect(board(p).tickets.size).toBe(0);
});

test("28.3 writers see the scope tiers", async () => {
  const p = proj(
    [["auth", undefined], ["auth-token", "auth"], ["auth-sso", "auth"], ["payments-api", undefined], ["checkout", undefined]],
    [],
    [["checkout", "payments-api"], ["payments-api", "auth-token"]],
  );
  await withTarget(p);
  writers(p);
  await p.werk(["plan", "checkout"]);
  const ls = p.launches();
  expect(ls.length).toBe(2);
  for (const l of ls) {
    const prompt = l.messages[0] as string;
    const t2 = prompt.indexOf("Tier two");
    expect(t2).toBeGreaterThan(0);
    const first = prompt.slice(0, t2);
    expect(first).toContain("checkout");
    expect(first).toContain("payments-api");
    expect(prompt.slice(t2)).toContain("auth-token");
    expect(prompt).not.toContain("auth-sso");
    expect(prompt).not.toContain("### #auth ");
    expect(prompt).not.toContain("#auth —");
  }
  expect(ls.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  for (const l of ls) expect((l.messages[0] as string).length).toBeGreaterThan(0);
  console.log(ls.map((l) => l.args.join(" ").slice(0, 300)));
});

test("28.4 taken answer id fails plan, bad ticket off board", async () => {
  const p = proj([["checkout", undefined], ["checkout-retry-limit", "checkout"]]);
  await withTarget(p);
  const noac = ticket("Bad", "checkout", "", "2").replace(/## Acceptance criteria\n\n- It works.\n\n/, "");
  writers(p, { sa: [answer("retry-limit")], tickets: { "01.md": ticket("Pay", "checkout, checkout-retry-limit", "", "1"), "02.md": noac } });
  const run = await p.werk(["plan", "checkout"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("checkout-retry-limit");
  const nodes = (await p.werk(["show", "checkout-retry-limit"])).out;
  expect(nodes).not.toContain("proposed");
  const b = board(p);
  expect(b.tickets.get("checkout/01")?.column).toMatch(/ready|blocked/);
  expect(b.tickets.has("checkout/02")).toBe(false);
});

test("28.5 target rules", async () => {
  const p = proj([["checkout", undefined]]);
  writers(p);
  let r = await p.werk(["plan", "checkout"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("werk target");
  await Bun.write(join(p.dir, "plain.txt"), "x");
  r = await p.werk(["target", join(p.dir, "plain.txt")]);
  expect(r.code).not.toBe(0);
  expect((await p.werk(["target"])).code).not.toBe(0);
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  r = await p.werk(["target", p.target]);
  expect(r.code).toBe(0);
  r = await p.werk(["target"]);
  expect(r.out.trim()).toBe(p.target);
});
