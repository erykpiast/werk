import { expect, test } from "bun:test";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent, readBoard, readBoardLog } from "../src/board/log.ts";
import { readMap } from "../src/map/store.ts";
import type { Step } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

const spec = (stories: [number, string][]) =>
  `# Spec: s\n\n## User stories\n\n${stories.map(([n, t]) => `${n}. As a person, I want ${t}.`).join("\n")}\n\n## Test seams\n\nThe command line.\n`;
const ticket = (title: string, cites: string, blockedBy: string, stories: string, checks = "- `make test`") => `title: ${title}
cites: ${cites}
blocked_by: ${blockedBy}
stories: ${stories}
touches: x

## What to build

A person does it.

## Acceptance criteria

- It works.

## Checks

${checks}
`;
const edit = (path: string, content: string): Step => ({ edit: { path, content } });

type Ev = { type: string; payload: Record<string, unknown> };
const card = (id: string, parent?: string, extra: Record<string, unknown> = {}): Ev => ({
  type: "node.added",
  payload: { id, kind: "card", title: `Card ${id}`, ...(parent ? { parent } : {}), ...extra },
});
const decided = (id: string): Ev => ({ type: "node.decided", payload: { id } });
function seed(p: Project, events: Ev[]) {
  const log = join(p.dir, ".werk", "log.jsonl");
  const seq = readMap("t", log).lastSeq;
  appendFileSync(log, `${events.map((e, i) => JSON.stringify({ seq: seq + i + 1, at: "t", actor: "you", ...e })).join("\n")}\n`);
}
async function withTarget(p: Project) {
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
}
const boardFile = (p: Project) => join(p.dir, ".werk", "board.jsonl");
const board = (p: Project) => readBoard(boardFile(p));
const mapOf = (p: Project) => readMap("t", join(p.dir, ".werk", "log.jsonl"));

// ---------- 28
function checkoutProject(extra: Ev[] = []): Project {
  const p = freshProject();
  seed(p, [card("checkout"), card("checkout-cart", "checkout"), decided("checkout-cart"), decided("checkout"), ...extra]);
  return p;
}
const answer = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Which ${slug}?`, body: "B." });
function checkoutWriters(p: Project, o: { tickets?: Record<string, string>; sa?: unknown[]; ta?: unknown[] } = {}) {
  const tickets = o.tickets ?? {
    "01.md": ticket("Cart", "checkout, checkout-cart", "", "1"),
    "02.md": ticket("Pay", "checkout", "1", "2"),
  };
  p.script({
    roles: {
      "spec-writer": {
        replies: [[edit(".werk/specs/checkout.md", spec([[1, "a cart"], [2, "to pay"]])), edit(".werk/specs/checkout.spec-answers.json", JSON.stringify(o.sa ?? []))]],
      },
      "ticket-writer": {
        replies: [[...Object.entries(tickets).map(([f, t]) => edit(`.werk/tickets/checkout/${f}`, t)), edit(".werk/specs/checkout.ticket-answers.json", JSON.stringify(o.ta ?? []))]],
      },
    },
  });
}

test("28.1 plan over decided subtree", async () => {
  const p = checkoutProject();
  await withTarget(p);
  checkoutWriters(p, { sa: [answer("retry-limit")], ta: [answer("ticket-order")] });
  const r = await p.werk(["plan", "checkout"]);
  console.log(r);
  expect(r.code).toBe(0);
  expect(existsSync(join(p.dir, ".werk", "specs", "checkout.md"))).toBe(true);
  expect([...board(p).tickets.keys()]).toEqual(["checkout/01", "checkout/02"]);
  for (const t of board(p).tickets.values()) expect(["ready", "blocked"]).toContain(t.column);
  const m = mapOf(p);
  for (const id of ["checkout-retry-limit", "checkout-ticket-order"]) {
    expect(m.nodes.get(id)).toMatchObject({ proposed: true });
    expect(m.ghostEdges).toContainEqual({ from: id, to: "checkout", type: "refines" });
    const s = await p.werk(["show", id]);
    console.log(s.out);
    expect((m.nodes.get(id) as { who?: string }).who).toBe("me");
  }
  const ev = readBoardLog(boardFile(p)).events;
  const steps = ev.filter((e) => e.type === "plan.step") as { payload: { step: string; log?: string } }[];
  expect(ev[0]?.type).toBe("plan.started");
  expect(ev.at(-1)?.type).toBe("plan.ended");
  expect(steps.find((s) => s.payload.step === "spec writer")?.payload.log).toBeTruthy();
  expect(steps.find((s) => s.payload.step === "ticket writer")?.payload.log).toBeTruthy();
});

test("28.2 open card stops the plan", async () => {
  const p = checkoutProject([card("checkout-draft", "checkout")]);
  await withTarget(p);
  checkoutWriters(p);
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("checkout-draft");
  expect(p.launches()).toEqual([]);
  expect(board(p).tickets.size).toBe(0);
});

test("28.3 scope tiers", async () => {
  const p = freshProject();
  seed(p, [
    card("auth"), card("auth-token", "auth"), card("auth-sso", "auth"), card("payments-api"), card("checkout"),
    decided("auth"), decided("auth-token"), decided("auth-sso"), decided("payments-api"), decided("checkout"),
    { type: "edge.added", payload: { from: "checkout", to: "payments-api", type: "depends_on", why: "pays" } },
    { type: "edge.added", payload: { from: "payments-api", to: "auth-token", type: "depends_on", why: "auth" } },
  ]);
  await withTarget(p);
  checkoutWriters(p, { tickets: { "01.md": ticket("Pay", "checkout", "", "1,2") } });
  const r = await p.werk(["plan", "checkout"]);
  console.log(r.code, r.err);
  const [spec_] = p.launches();
  expect(spec_?.role).toBe("spec-writer");
  const prompt = spec_?.messages[0] as string;
  const t2 = prompt.indexOf("Tier two");
  const t1 = prompt.indexOf("Tier one");
  expect(t1).toBeGreaterThanOrEqual(0);
  expect(t2).toBeGreaterThan(t1);
  const first = prompt.slice(t1, t2), second = prompt.slice(t2);
  expect(first).toContain("checkout");
  expect(first).toContain("payments-api");
  expect(second).toContain("auth-token");
  for (const l of p.launches()) {
    const pr = l.messages[0] as string;
    expect(pr).not.toContain("auth-sso");
    expect(pr).not.toMatch(/#auth\b(?!-)/);
  }
  console.log(p.launches().map((l) => l.role), p.launches().map((l) => l.args.join(" ").slice(0, 0)));
  expect(p.launches().map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  expect(p.launches()[0]?.args.join(" ")).toContain("spec writer");
  expect(p.launches()[1]?.args.join(" ")).toContain("ticket writer");
});

test("28.4 taken id fails, bad ticket off board", async () => {
  const p = checkoutProject([card("checkout-retry-limit", "checkout"), decided("checkout-retry-limit")]);
  await withTarget(p);
  checkoutWriters(p, {
    sa: [answer("retry-limit")],
    tickets: {
      "01.md": ticket("Cart", "checkout, checkout-cart, checkout-retry-limit", "", "1,2"),
      "02.md": ticket("NoAC", "checkout", "", "1").replace("## Acceptance criteria\n\n- It works.\n\n", ""),
    },
  });
  const before = readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter((l) => l.includes('"checkout-retry-limit"')).length;
  const r = await p.werk(["plan", "checkout"]);
  console.log(r);
  expect(r.code).not.toBe(0);
  expect(r.err + r.out).toContain("checkout-retry-limit");
  const after = readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter((l) => l.includes('"checkout-retry-limit"')).length;
  expect(after).toBe(before);
  expect([...board(p).tickets.keys()]).toEqual(["checkout/01"]);
  expect(["ready", "blocked"]).toContain(board(p).tickets.get("checkout/01")?.column as string);
});

test("28.5 target", async () => {
  const p = checkoutProject();
  checkoutWriters(p);
  let r = await p.werk(["plan", "checkout"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("werk target");
  writeFileSync(join(p.dir, "plain.txt"), "x");
  r = await p.werk(["target", join(p.dir, "plain.txt")]);
  expect(r.code).not.toBe(0);
  expect((await p.werk(["target"])).out).toBe("");
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  r = await p.werk(["target", p.target]);
  expect(r.code).toBe(0);
  r = await p.werk(["target"]);
  expect(r.code).toBe(0);
  expect(r.out.trim()).toBe(p.target);
});
