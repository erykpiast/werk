import { expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { all, card, events, freshProject, root, seed, w } from "./helpers.ts";
import type { Project } from "./helpers.ts";

const dec = { status: "decided", who: "me" };
const edit = (path: string, content: string) => ({ edit: { path, content } });

const SPEC = (n = 2) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want story ${i + 1}.`).join("\n")}\n\n## Test seams\n\nThe command line.\n`;
const ticket = (title: string, cites: string, blocked: string, stories: string, checks = "- `make test`") =>
  `title: ${title}\ncites: ${cites}\nblocked_by: ${blocked}\nstories: ${stories}\ntouches: login\n\n## What to build\n\nA person logs in.\n\n## Acceptance criteria\n\n- It works.\n\n## Checks\n\n${checks}\n`;

async function withTarget(p: Project) {
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  const r = await p.werk(["target", p.target]);
  expect(r.code, all(r)).toBe(0);
}

/** root > sub (decided) > a, b (decided). */
function planProject(sub = "checkout", extra: (p: Project) => void = () => undefined) {
  const p = freshProject();
  root(p);
  card(p, sub, { title: `Sub ${sub}`, ...dec });
  card(p, `${sub}-a`, { title: "Card A", parent: sub, ...dec });
  card(p, `${sub}-b`, { title: "Card B", parent: sub, ...dec });
  extra(p);
  return p;
}

const files = (sub: string, t: Record<string, string>) =>
  Object.entries(t).map(([f, text]) => edit(`.werk/tickets/${sub}/${f}`, text));
const goodTickets = (sub: string) => ({
  "01.md": ticket("First", `${sub}, ${sub}-a`, "", "1"),
  "02.md": ticket("Second", `${sub}-b`, "1", "2"),
});
const answer = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Why ${slug}?`, body: "The body." });

function writers(p: Project, sub: string, o: { tickets?: Record<string, string>; spec?: string; sa?: unknown[]; ta?: unknown[] } = {}) {
  p.script({
    roles: {
      "spec-writer": {
        replies: [[edit(`.werk/specs/${sub}.md`, o.spec ?? SPEC()), edit(`.werk/specs/${sub}.spec-answers.json`, JSON.stringify(o.sa ?? []))]],
      },
      "ticket-writer": {
        replies: [[...files(sub, o.tickets ?? goodTickets(sub)), edit(`.werk/specs/${sub}.ticket-answers.json`, JSON.stringify(o.ta ?? []))]],
      },
    },
  });
}
const board = (p: Project) => {
  const f = join(p.dir, ".werk", "board.jsonl");
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const tickets = (p: Project) => {
  const m = new Map<string, { column: string; archived: boolean; reason?: string; title?: string }>();
  for (const e of board(p)) {
    const id = e.payload.id;
    if (e.type === "ticket.planned") m.set(id, { column: e.payload.blocked_by.length ? "blocked" : "ready", archived: false, title: e.payload.title });
    if (e.type === "ticket.moved") Object.assign(m.get(id) ?? {}, { column: e.payload.to, reason: e.payload.reason });
    if (e.type === "ticket.archived") Object.assign(m.get(id) ?? {}, { archived: true });
    if (e.type === "ticket.restored") Object.assign(m.get(id) ?? {}, { archived: false });
  }
  return m;
};

test("[28.1] a plan over a decided subtree writes a spec, puts tickets on the board, proposes answers as ghosts", async () => {
  const p = planProject();
  await withTarget(p);
  writers(p, "checkout", { sa: [answer("retry-limit")], ta: [answer("ticket-order")] });
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code, all(r)).toBe(0);
  expect(existsSync(join(p.dir, ".werk", "specs", "checkout.md"))).toBe(true);
  const t = tickets(p);
  expect([...t.keys()]).toEqual(["checkout/01", "checkout/02"]);
  for (const v of t.values()) expect(["ready", "blocked"]).toContain(v.column);
  for (const id of ["checkout-retry-limit", "checkout-ticket-order"]) {
    const s = all(await w(p, "show", id));
    expect(s).toContain("proposed");
    expect(s).toMatch(/parent: checkout/);
    expect(s).toContain("who: me");
  }
  const types = board(p).map((e) => [e.type, e.payload.step ?? ""].join(":"));
  expect(types[0]).toBe("plan.started:");
  expect(types).toContain("plan.step:spec writer");
  expect(types).toContain("plan.step:ticket writer");
  expect(types.at(-1)).toBe("plan.ended:");
  for (const e of board(p).filter((e) => e.type === "plan.step" && e.payload.step !== "checks")) expect(e.payload.log).toBeTruthy();
});

test("[28.2] an open card in the subtree stops the plan before any writer runs", async () => {
  const p = planProject("checkout", (q) => card(q, "checkout-open", { title: "Open one", parent: "checkout", status: "open" }));
  await withTarget(p);
  writers(p, "checkout");
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("checkout-open");
  expect(p.launches()).toEqual([]);
  expect(tickets(p).size).toBe(0);
});

test("[28.3] the writers see the cards the subtree rests on, not the cards beside them", async () => {
  const p = freshProject();
  root(p);
  card(p, "checkout", { title: "Checkout", ...dec });
  card(p, "payments-api", { title: "Payments API", ...dec });
  card(p, "auth", { title: "Auth parent", ...dec });
  card(p, "auth-token", { title: "Auth token", parent: "auth", ...dec });
  card(p, "auth-sso", { title: "Auth SSO", parent: "auth", ...dec });
  seed(p, "edge.added", { from: "checkout", to: "payments-api", type: "depends_on", why: "pays" });
  seed(p, "edge.added", { from: "payments-api", to: "auth-token", type: "depends_on", why: "auth" });
  await withTarget(p);
  writers(p, "checkout", { tickets: { "01.md": ticket("First", "checkout, payments-api", "", "1"), "02.md": ticket("Second", "checkout", "1", "2") } });
  await p.werk(["plan", "checkout"]);
  const ls = p.launches();
  expect(ls.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  const spec = ls[0]?.messages[0] as string;
  const tier2 = spec.search(/tier two/i);
  expect(tier2).toBeGreaterThan(0);
  const first = spec.slice(0, tier2);
  const second = spec.slice(tier2);
  expect(first).toContain("checkout");
  expect(first).toContain("payments-api");
  expect(second).toContain("auth-token");
  for (const l of ls) {
    const m = l.messages[0] as string;
    expect(m).not.toContain("auth-sso");
    expect(m).not.toMatch(/#auth\b(?!-)/);
  }
  expect((ls[0]?.args.join(" ") ?? "").toLowerCase()).toContain("you are the spec writer");
  expect((ls[1]?.args.join(" ") ?? "").toLowerCase()).toContain("you are the ticket writer");
});

test("[28.4] an answer whose id is taken fails the plan, and a bad ticket stays off the board", async () => {
  const p = planProject("checkout", (q) => card(q, "checkout-retry-limit", { title: "Taken", parent: "checkout", ...dec }));
  await withTarget(p);
  const bad = `title: Bad\ncites: checkout-b\nblocked_by: \nstories: 2\ntouches: x\n\n## What to build\n\nSomething.\n\n## Acceptance criteria\n\n## Checks\n\n- \`make test\`\n`;
  writers(p, "checkout", { sa: [answer("retry-limit")], tickets: { "01.md": ticket("First", "checkout, checkout-a, checkout-retry-limit", "", "1"), "02.md": bad } });
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("checkout-retry-limit");
  const s = all(await w(p, "show", "checkout-retry-limit"));
  expect(s).toContain("Taken");
  const t = tickets(p);
  expect(t.has("checkout/01")).toBe(true);
  expect(["ready", "blocked"]).toContain(t.get("checkout/01")?.column);
  expect(t.has("checkout/02")).toBe(false);
});

test("[28.5] a project with no target cannot plan until the person sets a valid target", async () => {
  const p = planProject();
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).toBe(1);
  expect(all(r)).toContain("werk target");
  const file = join(p.dir, "plain.txt");
  appendFileSync(file, "x");
  const bad = await p.werk(["target", file]);
  expect(bad.code).not.toBe(0);
  expect((await p.werk(["target"])).out).not.toContain(file);
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  const ok = await p.werk(["target", p.target]);
  expect(ok.code, all(ok)).toBe(0);
  const shown = await p.werk(["target"]);
  expect(shown.out.trim()).toBe(p.target);
});

// ---- 82 (same flow, feature tier)
test("[82.1] a plan over a decided subtree records a feature run, and proposes the answers as ghosts", async () => {
  const p = planProject("auth");
  await withTarget(p);
  const ans = (slug: string) => ({ slug, title: `T ${slug}`, why: `W ${slug}`, body: `B ${slug}` });
  writers(p, "auth", { sa: [ans("token-ttl")], ta: [ans("split-login")] });
  const r = await p.werk(["plan", "#auth"]);
  expect(r.code, all(r)).toBe(0);
  const first = board(p)[0];
  expect(first.type).toBe("tier");
  expect(first.payload.tier).toBe("feature");
  expect(tickets(p).size).toBe(2);
  for (const slug of ["token-ttl", "split-login"]) {
    const s = all(await w(p, "show", `auth-${slug}`));
    expect(s).toContain("proposed");
    expect(s).toMatch(/parent: auth/);
    expect(s).toContain("who: me");
    expect(s).toContain(`T ${slug}`);
    expect(s).toContain(`W ${slug}`);
    expect(s).toContain(`B ${slug}`);
  }
});

test("[82.2] a plan stops with an error when an answer record has an id already in the map", async () => {
  const p = planProject("auth", (q) => card(q, "auth-token-ttl", { title: "Taken", parent: "auth", ...dec }));
  await withTarget(p);
  writers(p, "auth", { sa: [answer("token-ttl")] });
  const r = await p.werk(["plan", "#auth"]);
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("token-ttl");
  expect(events(p).filter((e) => e.payload.id === "auth-token-ttl").length).toBe(1);
});

test("[82.3] a ticket that fails its own checks stays off the board and gives no coverage", async () => {
  const p = planProject("auth");
  await withTarget(p);
  const login = `title: Login\ncites: auth-a\nblocked_by: \ntouches: x\n\n## What to build\n\nLogin.\n\n## Acceptance criteria\n\n- ok\n\n## Checks\n\n- \`make test\`\n`;
  writers(p, "auth", { tickets: { "01.md": login.replace("auth-a", "auth-a"), "02.md": ticket("Logout", "auth, auth-b", "", "1, 2") } });
  const r = await p.werk(["plan", "auth"]);
  expect(r.code).not.toBe(0);
  const t = tickets(p);
  expect(t.has("auth/02")).toBe(true);
  expect(t.has("auth/01")).toBe(false);
  expect(r.out).toMatch(/stories/);
  expect(r.out).toMatch(/cites: no ticket cites #auth-a/);
});

test("[82.4] a ticket that names a failed ticket as a blocker is blocked, its correct blockers go to ready", async () => {
  const p = planProject("auth");
  await withTarget(p);
  const a = ticket("A", "auth", "", "1").replace("stories: 1\n", "");
  writers(p, "auth", {
    tickets: {
      "01.md": a,
      "02.md": ticket("B", "auth, auth-a", "", "1"),
      "03.md": ticket("C", "auth-b", "1, 2", "2"),
    },
  });
  const r = await p.werk(["plan", "auth"]);
  const t = tickets(p);
  expect(t.has("auth/01")).toBe(false);
  expect(t.get("auth/03")?.column).toBe("blocked");
  expect(t.get("auth/02")?.column).toBe("ready");
});

test("[82.5] a second plan archives an open ticket that the new spec drops, and a restore puts it back", async () => {
  const p = planProject("auth");
  await withTarget(p);
  const t2 = { "01.md": ticket("login", "auth, auth-a", "", "1"), "02.md": ticket("logout", "auth-b", "", "2") };
  const t1 = { "01.md": ticket("login", "auth, auth-a, auth-b", "", "1, 2") };
  p.script({
    roles: {
      "spec-writer": { replies: [[edit(".werk/specs/auth.md", SPEC())], [edit(".werk/specs/auth.md", SPEC())]] },
      "ticket-writer": { replies: [[...files("auth", t2)], [...files("auth", t1)]] },
    },
  });
  expect((await p.werk(["plan", "auth"])).code).toBe(0);
  expect(tickets(p).get("auth/02")?.archived).toBe(false);
  const r = await p.werk(["plan", "auth"]);
  expect(r.code, all(r)).toBe(0);
  const arch = board(p).find((e) => e.type === "ticket.archived");
  expect(arch?.payload.id).toBe("auth/02");
  expect(arch?.payload.reason).toMatch(/no longer needs it/);
  expect(tickets(p).get("auth/01")?.archived).toBe(false);
  const res = await p.werk(["ticket", "restore", "auth/02"]);
  expect(res.code, all(res)).toBe(0);
  expect(tickets(p).get("auth/02")?.archived).toBe(false);
});
