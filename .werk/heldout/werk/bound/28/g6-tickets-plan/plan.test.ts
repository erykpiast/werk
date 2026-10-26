import { expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard, readBoardLog } from "../../src/board/log.ts";
import { readMap } from "../../src/map/store.ts";
import type { Step } from "../../src/test/fake-script.ts";
import { freshProject, type Project } from "../../src/test/project.ts";

const SPEC = `# Spec: checkout

## User stories

1. As a person, I want to pay.
2. As a person, I want a receipt.

## Test seams

The command line.
`;

const ticket = (title: string, cites: string, blockedBy: string, stories: string, criteria = "- It works.") => `title: ${title}
cites: ${cites}
blocked_by: ${blockedBy}
stories: ${stories}
touches: checkout

## What to build

A person pays.

## Acceptance criteria

${criteria}

## Checks

- \`make test\`
`;

type Event = { type: string; payload: Record<string, unknown> };
const card = (id: string, parent?: string): Event => ({
  type: "node.added",
  payload: { id, kind: "card", title: `Card ${id}`, ...(parent ? { parent } : {}) },
});
const decided = (...ids: string[]): Event[] => ids.map((id) => ({ type: "node.decided", payload: { id } }));
const dep = (from: string, to: string): Event => ({ type: "edge.added", payload: { from, to, type: "depends_on", why: "needs it" } });

function project(events: Event[]): Project {
  const p = freshProject();
  const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
  return p;
}
async function withTarget(p: Project) {
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
}
const edit = (path: string, content: string): Step => ({ edit: { path, content } });
const answer = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Which ${slug}?`, body: "The body." });

function writers(p: Project, tickets: Record<string, string>, specAnswers: unknown[] = [], ticketAnswers: unknown[] = []) {
  p.script({
    roles: {
      "spec-writer": {
        replies: [[edit(".werk/specs/checkout.md", SPEC), edit(".werk/specs/checkout.spec-answers.json", JSON.stringify(specAnswers))]],
      },
      "ticket-writer": {
        replies: [[
          ...Object.entries(tickets).map(([f, t]) => edit(`.werk/tickets/checkout/${f}`, t)),
          edit(".werk/specs/checkout.ticket-answers.json", JSON.stringify(ticketAnswers)),
        ]],
      },
    },
  });
}
const boardPath = (p: Project) => join(p.dir, ".werk", "board.jsonl");
const boardEvents = (p: Project) => (existsSync(boardPath(p)) ? readBoardLog(boardPath(p)).events : []);

const SUBTREE = [card("root"), card("checkout", "root"), card("checkout-pay", "checkout"), ...decided("root", "checkout", "checkout-pay")];
const GOOD = {
  "01.md": ticket("Pay", "checkout, checkout-pay", "", "1"),
  "02.md": ticket("Receipt", "checkout-pay", "1", "2"),
};

test("28.1 a plan over a decided subtree", async () => {
  const p = project(SUBTREE);
  await withTarget(p);
  writers(p, GOOD, [answer("retry-limit")], [answer("ticket-order")]);
  const run = await p.werk(["plan", "checkout"]);
  console.log("28.1", JSON.stringify(run));
  expect(run.code).toBe(0);
  expect(readFileSync(join(p.dir, ".werk", "specs", "checkout.md"), "utf8")).toBe(SPEC);
  const board = readBoard(boardPath(p));
  for (const id of ["checkout/01", "checkout/02"]) expect(["ready", "blocked"]).toContain(board.tickets.get(id)?.column);
  const map = readMap("test", join(p.dir, ".werk", "log.jsonl"));
  for (const id of ["checkout-retry-limit", "checkout-ticket-order"]) {
    expect(map.nodes.get(id)).toMatchObject({ proposed: true, who: "me" });
    expect(map.ghostEdges).toContainEqual({ from: id, to: "checkout", type: "refines" });
  }
  const events = boardEvents(p);
  console.log("28.1 board", JSON.stringify(events.map((e) => [e.type, e.payload])));
  expect(events[0]?.type).toBe("plan.started");
  expect(events.at(-1)?.type).toBe("plan.ended");
  for (const step of ["spec writer", "ticket writer"]) {
    const e = events.find((x) => x.type === "plan.step" && (x.payload as { step?: string }).step === step);
    const log = (e?.payload as { log?: string } | undefined)?.log;
    expect(typeof log).toBe("string");
    expect(existsSync(join(p.dir, ".werk", log as string))).toBe(true);
  }
});

test("28.2 an open card stops the plan before any writer", async () => {
  const p = project([card("root"), card("checkout", "root"), card("checkout-draft", "checkout"), ...decided("root", "checkout")]);
  await withTarget(p);
  writers(p, GOOD);
  const run = await p.werk(["plan", "checkout"]);
  console.log("28.2", JSON.stringify(run));
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("checkout-draft");
  expect(p.launches()).toEqual([]);
  expect(boardEvents(p).filter((e) => e.type === "ticket.planned")).toEqual([]);
});

test("28.3 writers see the cards the subtree rests on, not siblings", async () => {
  const p = project([
    card("root"), card("checkout", "root"), card("payments-api", "root"), card("auth", "root"),
    card("auth-token", "auth"), card("auth-sso", "auth"),
    ...decided("root", "checkout", "payments-api", "auth", "auth-token", "auth-sso"),
    dep("checkout", "payments-api"), dep("payments-api", "auth-token"),
  ]);
  await withTarget(p);
  writers(p, { "01.md": ticket("Pay", "checkout, payments-api", "", "1, 2") });
  const run = await p.werk(["plan", "checkout"]);
  console.log("28.3", JSON.stringify(run));
  const launches = p.launches();
  expect(launches.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  const spec = launches[0]?.messages[0] as string;
  const t1 = spec.indexOf("## Tier one");
  const t2 = spec.indexOf("## Tier two");
  expect(t1).toBeGreaterThan(-1);
  for (const id of ["checkout", "payments-api"]) {
    const at = spec.indexOf(`### #${id} —`);
    expect(at).toBeGreaterThan(t1);
    expect(at).toBeLessThan(t2);
  }
  expect(spec.indexOf("### #auth-token —")).toBeGreaterThan(t2);
  for (const l of launches) {
    const prompt = l.messages[0] as string;
    expect(prompt).not.toContain("#auth-sso");
    expect(prompt).not.toMatch(/#auth(?![\w-])/);
  }
});

test("28.4 a taken answer id fails the plan; a bad ticket stays off the board", async () => {
  const p = project([...SUBTREE.slice(0, 3), card("checkout-retry-limit", "checkout"), ...decided("root", "checkout", "checkout-pay", "checkout-retry-limit")]);
  await withTarget(p);
  writers(p, {
    "01.md": ticket("Pay", "checkout, checkout-pay, checkout-retry-limit", "", "1, 2"),
    "02.md": ticket("Receipt", "checkout-pay", "", "2", ""),
  }, [answer("retry-limit")]);
  const before = readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter((l) => l.includes('"checkout-retry-limit"')).length;
  const run = await p.werk(["plan", "checkout"]);
  console.log("28.4", JSON.stringify(run));
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("checkout-retry-limit");
  const map = readMap("test", join(p.dir, ".werk", "log.jsonl"));
  expect(map.nodes.get("checkout-retry-limit")?.proposed ?? false).toBe(false);
  const adds = readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter((l) => l.includes('"checkout-retry-limit"') && /node\.(added|proposed)/.test(l));
  expect(adds.length).toBe(1);
  expect(before).toBeGreaterThan(0);
  const board = readBoard(boardPath(p));
  console.log("28.4 board", JSON.stringify([...board.tickets.values()]));
  expect(["ready", "blocked"]).toContain(board.tickets.get("checkout/01")?.column);
  expect(board.tickets.has("checkout/02")).toBe(false);
});

test("28.5 no target until a valid target is set", async () => {
  const p = project(SUBTREE);
  writers(p, GOOD);
  const run = await p.werk(["plan", "checkout"]);
  console.log("28.5 plan", JSON.stringify(run));
  expect(run.code).toBe(1);
  expect(run.err).toContain("werk target");
  const file = join(p.dir, "..", "plain.txt");
  writeFileSync(file, "x");
  const bad = await p.werk(["target", file]);
  console.log("28.5 bad", JSON.stringify(bad));
  expect(bad.code).not.toBe(0);
  const none = await p.werk(["target"]);
  console.log("28.5 none", JSON.stringify(none));
  expect(none.code).not.toBe(0);
  expect(none.out).toBe("");
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  const good = await p.werk(["target", p.target]);
  expect(good.code).toBe(0);
  const show = await p.werk(["target"]);
  console.log("28.5 show", JSON.stringify(show));
  expect(show.code).toBe(0);
  expect(show.out.trim()).toBe(p.target);
});
