import { expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent, readBoard, readBoardLog } from "../src/board/log.ts";
import type { Step } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";
import { card, decided, edge, events, kill, lines, ok, root, seed, w } from "./h.ts";

const specText = (n: number) =>
  `# Spec: x\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Test seams\n\nThe command line.\n`;
const ticket = (title: string, cites: string, blockedBy: string, stories: string, ac = true, body = "A person does it.") =>
  `title: ${title}\ncites: ${cites}\nblocked_by: ${blockedBy}\nstories: ${stories}\ntouches: login\n\n## What to build\n\n${body}\n\n${ac ? "## Acceptance criteria\n\n- It works.\n\n" : ""}## Checks\n\n- \`make test\`\n`;
const edit = (path: string, content: string): Step => ({ edit: { path, content } });
const answer = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Which ${slug}?`, body: "The body." });

async function withTarget(p: Project) {
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
}
const boardFile = (p: Project) => join(p.dir, ".werk", "board.jsonl");
const bevents = (p: Project) => readBoardLog(boardFile(p)).events;
const board = (p: Project) => readBoard(boardFile(p));

/** checkout subtree: checkout + c1 + c2 decided under root. */
function checkoutProject(extra: any[] = []) {
  const p = freshProject();
  seed(p, [
    ...root(),
    decided("checkout", { title: "Checkout" }),
    decided("c1", { parent: "checkout", title: "C one" }),
    decided("c2", { parent: "checkout", title: "C two", body: "Original body." }),
    kill("c1"), kill("c2"),
    ...extra,
  ]);
  return p;
}
function script(p: Project, o: { spec?: string; specAnswers?: any[]; tickets?: Record<string, string>; ticketAnswers?: any[]; second?: any } = {}) {
  const files = (t: Record<string, string>) => Object.entries(t).map(([f, c]) => edit(`.werk/tickets/checkout/${f}`, c));
  const tickets = o.tickets ?? {
    "01.md": ticket("T one", "checkout, c1", "", "1"),
    "02.md": ticket("T two", "c2", "1", "2"),
  };
  const first = [
    [edit(".werk/specs/checkout.md", o.spec ?? specText(2)), edit(".werk/specs/checkout.spec-answers.json", JSON.stringify(o.specAnswers ?? []))],
    [...files(tickets), edit(".werk/specs/checkout.ticket-answers.json", JSON.stringify(o.ticketAnswers ?? []))],
  ];
  const replies = { "spec-writer": [first[0]!], "ticket-writer": [first[1]!] } as Record<string, Step[][]>;
  if (o.second) {
    replies["spec-writer"]!.push([edit(".werk/specs/checkout.md", o.second.spec), edit(".werk/specs/checkout.spec-answers.json", "[]")]);
    replies["ticket-writer"]!.push([...files(o.second.tickets), edit(".werk/specs/checkout.ticket-answers.json", "[]")]);
  }
  p.script({ roles: { "spec-writer": { replies: replies["spec-writer"]! }, "ticket-writer": { replies: replies["ticket-writer"]! } } });
}

test("28.1", async () => {
  const p = checkoutProject();
  await withTarget(p);
  script(p, { specAnswers: [answer("retry-limit")], ticketAnswers: [answer("ticket-order")] });
  const r = await p.werk(["plan", "checkout"]);
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(existsSync(join(p.dir, ".werk", "specs", "checkout.md"))).toBe(true);
  const b = board(p);
  for (const id of ["checkout/01", "checkout/02"]) expect(["ready", "blocked"]).toContain(b.tickets.get(id)?.column as string);
  for (const g of ["checkout-retry-limit", "checkout-ticket-order"]) {
    const s = (await w(p, ["show", g])).out;
    expect(s).toContain("proposed");
    expect(s).toContain("parent: checkout");
    expect(s).toContain("who: me");
  }
  const ev = bevents(p);
  const types = ev.map((e) => e.type);
  expect(types[0]).toBe("plan.started");
  expect(types.at(-1)).toBe("plan.ended");
  const steps = ev.filter((e) => e.type === "plan.step");
  expect(steps.map((s: any) => s.payload.step)).toEqual(expect.arrayContaining(["spec writer", "ticket writer"]));
  for (const s of steps.filter((s: any) => s.payload.step !== "checks")) expect((s as any).payload.log).toBeTruthy();
});

test("28.2", async () => {
  const p = checkoutProject([card("c-open", { parent: "checkout", title: "Open child" })]);
  await withTarget(p);
  script(p);
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("c-open");
  expect(p.launches()).toEqual([]);
  expect([...board(p).tickets.keys()]).toEqual([]);
});

test("28.3", async () => {
  const p = freshProject();
  seed(p, [
    ...root(),
    decided("platform", { title: "Platform parent" }),
    decided("auth-token", { parent: "platform", title: "Auth token" }),
    decided("auth-sso", { parent: "platform", title: "Auth sso" }),
    decided("payments-api", { title: "Payments api" }),
    decided("checkout", { title: "Checkout" }),
    decided("c1", { parent: "checkout" }),
    edge("checkout", "payments-api"),
    edge("payments-api", "auth-token"),
  ]);
  await withTarget(p);
  script(p, { tickets: { "01.md": ticket("T one", "checkout, c1", "", "1", true), "02.md": ticket("T two", "checkout, payments-api", "1", "2") } });
  await p.werk(["plan", "checkout"]);
  const launches = p.launches();
  console.log("28.3 roles:", launches.map((l) => l.role));
  for (const l of launches) {
    const prompt = l.messages[0] as string;
    const t2 = prompt.indexOf("Tier two");
    expect(t2).toBeGreaterThan(0);
    expect(prompt.indexOf("#checkout")).toBeGreaterThan(-1);
    expect(prompt.indexOf("#checkout")).toBeLessThan(t2);
    expect(prompt.indexOf("#payments-api")).toBeLessThan(t2);
    expect(prompt.indexOf("### #auth-token")).toBeGreaterThan(t2);
    expect(prompt).not.toContain("auth-sso");
    expect(prompt).not.toContain("#platform");
  }
  expect(launches.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
});

test("28.4", async () => {
  const p = checkoutProject([decided("checkout-retry-limit", { parent: "checkout", title: "Taken" })]);
  await withTarget(p);
  script(p, {
    specAnswers: [answer("retry-limit")],
    spec: specText(2),
    tickets: { "01.md": ticket("T one", "checkout, c1, checkout-retry-limit", "", "1"), "02.md": ticket("Bad", "c2", "", "2", false) },
  });
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("checkout-retry-limit");
  expect((await w(p, ["show", "checkout"])).out.match(/<- refines\s+checkout-retry-limit/g)?.length).toBe(1);
  const b = board(p);
  expect(["ready", "blocked"]).toContain(b.tickets.get("checkout/01")?.column as string);
  expect(b.tickets.has("checkout/02")).toBe(false);
});

test("28.5", async () => {
  const p = checkoutProject();
  let r = await p.werk(["plan", "checkout"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("werk target");
  writeFileSyncSafe(join(p.dir, "plain.txt"), "x");
  r = await p.werk(["target", join(p.dir, "plain.txt")]);
  expect(r.code).not.toBe(0);
  r = await p.werk(["target"]);
  expect(r.out.trim() === "" || /no target/i.test(r.out + r.err)).toBe(true);
  expect(r.out).not.toContain("plain.txt");
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  r = await p.werk(["target", p.target]);
  expect(r.code).toBe(0);
  r = await p.werk(["target"]);
  expect(r.out.trim()).toBe(p.target);
});
import { writeFileSync as writeFileSyncSafe } from "node:fs";

const two = (p: Project) => {
  appendBoardEvent(boardFile(p), "ticket.moved", { id: "checkout/01", to: "building" });
  for (const to of ["building", "merging", "done"] as const) appendBoardEvent(boardFile(p), "ticket.moved", { id: "checkout/02", to });
};

test("29.1", async () => {
  const p = checkoutProject();
  await withTarget(p);
  script(p, {
    spec: specText(3),
    tickets: {
      "01.md": ticket("T one", "checkout, c1", "", "1"),
      "02.md": ticket("T two", "c2", "", "2"),
      "03.md": ticket("T three", "c2", "", "3"),
    },
    second: {
      spec: specText(4),
      tickets: { "03.md": ticket("T three rewritten", "c2", "", "3"), "04.md": ticket("T four", "c3", "", "4") },
    },
  });
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  two(p);
  seed(p, [decided("c3", { parent: "checkout", title: "C three" })]);
  const r = await p.werk(["plan", "checkout"]);
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  const b = board(p);
  expect(b.tickets.get("checkout/03")?.title).toBe("T three rewritten");
  expect(b.tickets.get("checkout/04")?.title).toBe("T four");
  expect(b.tickets.get("checkout/01")).toMatchObject({ column: "building", title: "T one" });
  expect(b.tickets.get("checkout/02")).toMatchObject({ column: "done", title: "T two" });
  expect(readFileSync(join(p.dir, ".werk", "specs", "checkout.md"), "utf8")).toContain("thing 4");
  expect([...b.tickets.keys()].length).toBe(4);
});

test("29.2", async () => {
  const p = checkoutProject([decided("c3", { parent: "checkout", title: "C three" })]);
  await withTarget(p);
  script(p, {
    spec: specText(3),
    tickets: { "01.md": ticket("T one", "checkout, c1", "", "1"), "02.md": ticket("T two", "c2", "", "2"), "03.md": ticket("T three", "c3", "", "3") },
    second: { spec: specText(2), tickets: { "01.md": ticket("T one", "checkout, c1, c2", "", "1"), "02.md": ticket("T two", "c2", "", "2") } },
  });
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  await ok(p, ["remove", "c3", "--actor", "you"]);
  const r = await p.werk(["plan", "checkout"]);
  expect(r.err).toBe("");
  const t = board(p).tickets.get("checkout/03")!;
  expect(t.archived).toBe(true);
  const arch = bevents(p).find((e) => e.type === "ticket.archived") as any;
  expect(arch.payload.reason).toMatch(/no longer needs/);
  expect((await p.werk(["ticket", "restore", "checkout/03"])).code).toBe(0);
  expect(board(p).tickets.get("checkout/03")?.archived).toBe(false);
});

/** Start a server on the project so the cited-card watch runs. */
async function serve(p: Project) {
  const proc = p.start(["bun", join(import.meta.dir, "..", "src", "cli.ts"), "serve", "--port", "0"]);
  const reader = proc.stdout.getReader();
  let out = "";
  const dec = new TextDecoder();
  while (!/http:\/\//.test(out)) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  return proc;
}
const waitFor = async (f: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (f()) return true;
    await Bun.sleep(100);
  }
  return f();
};

test("29.3", async () => {
  const p = checkoutProject();
  await withTarget(p);
  script(p, { second: { spec: specText(2), tickets: { "01.md": ticket("T one", "checkout, c1", "", "1"), "02.md": ticket("T two", "c2", "1", "2") } } });
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  await serve(p);
  const target = "c2";
  await ok(p, ["propose", target, "--title", "C two renamed"]);
  await ok(p, ["accept", target, "--actor", "you"]);
  const blocked = await waitFor(() => board(p).tickets.get("checkout/02")?.column === "blocked");
  const t = board(p).tickets.get("checkout/02")!;
  console.log("29.3 ticket:", JSON.stringify(t));
  expect(blocked).toBe(true);
  expect(t.reason).toContain("c2");
  expect(t.reason).toMatch(/title/);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  expect(board(p).tickets.get("checkout/02")?.column).toBe("ready");
});

test("29.4", async () => {
  const p = checkoutProject();
  await withTarget(p);
  script(p, {
    tickets: { "01.md": ticket("T one", "checkout, c1, c2", "", "1"), "02.md": ticket("T two", "c2", "", "2") },
  });
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  appendBoardEvent(boardFile(p), "ticket.moved", { id: "checkout/01", to: "building" });
  await serve(p);
  await ok(p, ["say", "c2", "a note"]);
  await Bun.sleep(1500);
  expect(board(p).tickets.get("checkout/02")?.column).toBe("ready");
  expect(board(p).tickets.get("checkout/01")?.column).toBe("building");
  await ok(p, ["propose", "c2", "--ops", JSON.stringify([{ tag: "elaborated", old: "Original body.", new: "Changed body." }])]);
  await ok(p, ["accept", "c2", "--actor", "you"]);
  expect(await waitFor(() => board(p).tickets.get("checkout/02")?.column === "blocked")).toBe(true);
  const t = board(p).tickets.get("checkout/02")!;
  expect(t.reason).toContain("c2");
  expect(t.reason).toMatch(/body/);
  expect(board(p).tickets.get("checkout/01")?.column).toBe("building");
  expect(board(p).tickets.get("checkout/01")?.reason).toBeUndefined();
});

test("29.5", async () => {
  const p = checkoutProject();
  await withTarget(p);
  script(p);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  const proc = p.start(["bun", join(import.meta.dir, "..", "src", "cli.ts"), "serve", "--port", "0"]);
  const decErr = new TextDecoder();
  let err = "";
  const rd = proc.stderr.getReader();
  (async () => { for (;;) { const { value, done } = await rd.read(); if (done) break; err += decErr.decode(value); } })();
  await Bun.sleep(1500);
  seed(p, [decided("c9", { parent: "checkout", title: "Nine" })]);
  await waitFor(() => /c9/.test(err), 8000);
  console.log("29.5 server err:", err);
  expect(err).toMatch(/cards-cited/);
  expect(err).toContain("c9");
  for (const id of ["checkout/01", "checkout/02"]) {
    expect(board(p).tickets.get(id)?.column).toBe("ready");
    expect(board(p).tickets.get(id)?.reason).toBeUndefined();
  }
});

// ---- 82 ----
function authProject(extra: any[] = []) {
  const p = freshProject();
  seed(p, [...root(), decided("auth", { title: "Auth" }), decided("auth-session", { parent: "auth", title: "Session" }), decided("auth-other", { parent: "auth", title: "Other" }), ...extra]);
  return p;
}
const aScript = (p: Project, o: { spec?: any[]; ticket?: any[]; tickets: Record<string, string>; second?: Record<string, string> }) => {
  const files = (t: Record<string, string>) => Object.entries(t).map(([f, c]) => edit(`.werk/tickets/auth/${f}`, c));
  const sp = (ans: any[]) => [edit(".werk/specs/auth.md", specText(2)), edit(".werk/specs/auth.spec-answers.json", JSON.stringify(ans))];
  const tk = (t: Record<string, string>, ans: any[]) => [...files(t), edit(".werk/specs/auth.ticket-answers.json", JSON.stringify(ans))];
  p.script({
    roles: {
      "spec-writer": { replies: [sp(o.spec ?? []), ...(o.second ? [sp([])] : [])] },
      "ticket-writer": { replies: [tk(o.tickets, o.ticket ?? []), ...(o.second ? [tk(o.second, [])] : [])] },
    },
  });
};
const full = (t: string) => ticket(t, "auth, auth-session, auth-other", "", "1, 2");

test("82.1", async () => {
  const p = authProject();
  await withTarget(p);
  aScript(p, {
    spec: [{ slug: "token-ttl", title: "Token ttl", why: "Why ttl", body: "Body ttl" }],
    ticket: [{ slug: "split-login", title: "Split login", why: "Why split", body: "Body split" }],
    tickets: { "01.md": ticket("Login", "auth, auth-session, auth-other", "", "1"), "02.md": ticket("Logout", "auth", "", "2") },
  });
  const r = await p.werk(["plan", "auth"]);
  expect(r.err).toBe("");
  const first = bevents(p).find((e) => e.type === "plan.started" || e.type === ("plan.tier" as any));
  console.log("82.1 board events:", JSON.stringify(bevents(p).slice(0, 3)));
  const tierEv = [...events(p), ...bevents(p)].find((e: any) => e.type === "plan.tier" || e.type === "tier");
  expect(tierEv).toBeDefined();
  expect((tierEv as any).payload.tier).toBe("feature");
  expect([...board(p).tickets.keys()].length).toBe(2);
  for (const [id, t, why, body] of [["auth-token-ttl", "Token ttl", "Why ttl", "Body ttl"], ["auth-split-login", "Split login", "Why split", "Body split"]]) {
    const s = (await w(p, ["show", id!])).out;
    expect(s).toContain("proposed");
    expect(s).toContain("parent: auth");
    expect(s).toContain("who: me");
    for (const x of [t, why, body]) expect(s).toContain(x!);
  }
});

test("82.2", async () => {
  const p = authProject([decided("auth-token-ttl", { parent: "auth", title: "Taken" })]);
  await withTarget(p);
  aScript(p, { spec: [{ slug: "token-ttl", title: "T", why: "W", body: "B" }], tickets: { "01.md": full("Login") } });
  const r = await p.werk(["plan", "auth"]);
  expect(r.code).not.toBe(0);
  expect(r.err + r.out).toContain("token-ttl");
  expect((await w(p, ["show", "auth"])).out.match(/<- refines\s+auth-token-ttl/g)?.length).toBe(1);
});

test("82.3", async () => {
  const p = authProject();
  await withTarget(p);
  const noStories = ticket("Login", "auth-session", "", "1").replace("stories: 1\n", "");
  aScript(p, { tickets: { "01.md": noStories, "02.md": ticket("Logout", "auth, auth-other", "", "1, 2") } });
  const r = await p.werk(["plan", "auth"]);
  expect(r.code).not.toBe(0);
  console.log("82.3 out:", r.out, r.err);
  const b = board(p);
  const titles = [...b.tickets.values()].map((t) => t.title);
  expect(titles).toContain("Logout");
  expect(titles).not.toContain("Login");
  expect(r.out + r.err).toMatch(/stories/);
  expect(r.out + r.err).toMatch(/auth-session/);
});

test("82.4", async () => {
  const p = authProject();
  await withTarget(p);
  const a = ticket("A bad", "auth", "", "1", false);
  aScript(p, { tickets: { "01.md": a, "02.md": ticket("B", "auth, auth-session", "", "1"), "03.md": ticket("C", "auth-other", "1, 2", "2") } });
  await p.werk(["plan", "auth"]);
  const b = board(p);
  expect(b.tickets.has("auth/01")).toBe(false);
  expect(b.tickets.get("auth/03")?.column).toBe("blocked");
  expect(b.tickets.get("auth/02")?.column).toBe("ready");
});

test("82.5", async () => {
  const p = authProject();
  await withTarget(p);
  aScript(p, {
    tickets: { "01.md": ticket("login", "auth, auth-session", "", "1"), "02.md": ticket("logout", "auth-other", "", "2") },
    second: { "01.md": ticket("login", "auth, auth-session, auth-other", "", "1, 2") },
  });
  expect((await p.werk(["plan", "auth"])).code).toBe(0);
  const r = await p.werk(["plan", "auth"]);
  console.log("82.5:", r.out, r.err);
  const arch = bevents(p).find((e) => e.type === "ticket.archived") as any;
  expect(arch.payload.id).toBe("auth/02");
  expect(arch.payload.reason).toMatch(/current spec .*no longer needs it/);
  expect(board(p).tickets.get("auth/01")?.archived).toBe(false);
  expect((await p.werk(["ticket", "restore", "auth/02"])).code).toBe(0);
  expect(board(p).tickets.get("auth/02")?.archived).toBe(false);
});
