import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard, readBoardLog } from "../src/board/log.ts";
import { readMap } from "../src/map/store.ts";
import { freshProject } from "../src/test/project.ts";
import { card, decide, edit, type Event, mapProject, SPEC, ticket, withTarget } from "./h2628.ts";

const T = (n: string, s: string) => edit(`.werk/tickets/checkout/${n}`, s);
const ans = (slug: string) => ({ slug, title: `Answer ${slug}`, why: "Why?", body: "B" });
const base = (extra: Event[] = []) =>
  mapProject([card("checkout"), card("checkout-pay", "checkout"), decide("checkout"), decide("checkout-pay"), ...extra]);
function script(p: ReturnType<typeof base>, tickets: [string, string][], sa: unknown[], ta: unknown[]) {
  p.script({
    roles: {
      "spec-writer": { replies: [[edit(".werk/specs/checkout.md", SPEC(2)), edit(".werk/specs/checkout.spec-answers.json", JSON.stringify(sa))]] },
      "ticket-writer": { replies: [[...tickets.map(([n, t]) => T(n, t)), edit(".werk/specs/checkout.ticket-answers.json", JSON.stringify(ta))]] },
    },
  });
}
const good: [string, string][] = [
  ["01.md", ticket("One", "checkout, checkout-pay, checkout-retry-limit", "", "1,2")],
];
const bevents = (p: ReturnType<typeof base>) => readBoardLog(join(p.dir, ".werk", "board.jsonl")).events;

test("28.1", async () => {
  const p = base();
  await withTarget(p);
  script(p, [["01.md", ticket("One", "checkout, checkout-pay", "", "1")], ["02.md", ticket("Two", "checkout", "1", "2")]], [ans("retry-limit")], [ans("ticket-order")]);
  const run = await p.werk(["plan", "checkout"]);
  expect(run.code).toBe(0);
  expect(existsSync(join(p.dir, ".werk", "specs", "checkout.md"))).toBe(true);
  const board = readBoard(join(p.dir, ".werk", "board.jsonl"));
  for (const id of ["checkout/01", "checkout/02"]) expect(["ready", "blocked"]).toContain(board.tickets.get(id)?.column);
  const map = readMap("t", join(p.dir, ".werk", "log.jsonl"));
  for (const id of ["checkout-retry-limit", "checkout-ticket-order"]) {
    expect(map.nodes.get(id)).toMatchObject({ proposed: true, who: "me" });
    expect(map.ghostEdges).toContainEqual({ from: id, to: "checkout", type: "refines" });
    const show = await p.werk(["show", id]);
    console.log(show.out);
  }
  const ev = bevents(p);
  const types = ev.map((e) => [e.type, (e.payload as { step?: string }).step ?? ""]);
  expect(types[0]).toEqual(["plan.started", ""]);
  expect(types).toContainEqual(["plan.step", "spec writer"]);
  expect(types).toContainEqual(["plan.step", "ticket writer"]);
  expect(types.at(-1)).toEqual(["plan.ended", ""]);
  for (const s of ev.filter((e) => e.type === "plan.step" && ["spec writer", "ticket writer"].includes((e.payload as any).step)))
    expect(existsSync(join(p.dir, ".werk", (s.payload as { log: string }).log))).toBe(true);
});

test("28.2", async () => {
  const p = base([{ type: "node.added", payload: { id: "checkout-open", kind: "card", title: "Open", parent: "checkout" } }]);
  await withTarget(p);
  script(p, good, [], []);
  const run = await p.werk(["plan", "checkout"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("checkout-open");
  expect(p.launches()).toEqual([]);
  expect(readBoard(join(p.dir, ".werk", "board.jsonl")).tickets.size).toBe(0);
});

test("28.3", async () => {
  const dep = (from: string, to: string): Event => ({ type: "edge.added", payload: { from, to, type: "depends_on", why: "needs" } });
  const p = mapProject([
    card("root"), card("auth-area", "root"), card("auth-token", "auth-area"), card("auth-sso", "auth-area"),
    card("payments-api", "root"), card("checkout", "root"),
    ...["root", "auth-area", "auth-token", "auth-sso", "payments-api", "checkout"].map(decide),
    dep("checkout", "payments-api"), dep("payments-api", "auth-token"),
  ]);
  await withTarget(p);
  p.script({
    roles: {
      "spec-writer": { replies: [[edit(".werk/specs/checkout.md", SPEC(2)), edit(".werk/specs/checkout.spec-answers.json", "[]")]] },
      "ticket-writer": { replies: [[T("01.md", ticket("One", "checkout, payments-api", "", "1,2")), edit(".werk/specs/checkout.ticket-answers.json", "[]")]] },
    },
  });
  await p.werk(["plan", "checkout"]);
  const ls = p.launches();
  expect(ls.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  const spec = ls[0]?.messages[0] as string;
  const t2 = spec.indexOf("## Tier two");
  expect(t2).toBeGreaterThan(-1);
  const first = spec.slice(0, t2);
  const second = spec.slice(t2);
  expect(first).toContain("checkout");
  expect(first).toContain("payments-api");
  expect(second).toContain("auth-token");
  for (const l of ls) {
    const m = l.messages[0] as string;
    expect(m).not.toContain("auth-sso");
    expect(m).not.toContain("auth-area");
  }
});

test("28.4", async () => {
  const p = base([card("checkout-retry-limit", "checkout"), decide("checkout-retry-limit")]);
  await withTarget(p);
  const bad = ticket("Bad", "checkout", "", "1").replace("- It works.\n", "");
  script(p, [good[0] as [string, string], ["02.md", bad]], [ans("retry-limit")], []);
  const run = await p.werk(["plan", "checkout"]);
  expect(run.code).not.toBe(0);
  expect(run.err + run.out).toContain("checkout-retry-limit");
  const map = readMap("t", join(p.dir, ".werk", "log.jsonl"));
  expect([...map.nodes.keys()].filter((k) => k === "checkout-retry-limit")).toHaveLength(1);
  expect(map.nodes.get("checkout-retry-limit")?.proposed).not.toBe(true);
  const board = readBoard(join(p.dir, ".werk", "board.jsonl"));
  expect(["ready", "blocked"]).toContain(board.tickets.get("checkout/01")?.column);
  expect(board.tickets.has("checkout/02")).toBe(false);
});

test("28.5", async () => {
  const p = base();
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("werk target");
  const file = join(p.dir, "plain.txt");
  await Bun.write(file, "x");
  expect((await p.werk(["target", file])).code).not.toBe(0);
  expect((await p.werk(["target"])).code).not.toBe(0);
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
  const out = await p.werk(["target"]);
  expect(out.out.trim()).toBe(p.target);
});
