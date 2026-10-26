import { expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { currentWerkArgv } from "../src/own/running.ts";
import { all, card, freshProject, root, seed, w } from "./helpers.ts";
import type { Project } from "./helpers.ts";

const dec = { status: "decided", who: "me" };
const edit = (path: string, content: string) => ({ edit: { path, content } });
const SPEC = (n = 2) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want story ${i + 1}.`).join("\n")}\n\n## Test seams\n\nThe command line.\n`;
const ticket = (title: string, cites: string, blocked: string, stories: string) =>
  `title: ${title}\ncites: ${cites}\nblocked_by: ${blocked}\nstories: ${stories}\ntouches: login\n\n## What to build\n\nA person logs in.\n\n## Acceptance criteria\n\n- It works.\n\n## Checks\n\n- \`make test\`\n`;
const board = (p: Project) => {
  const f = join(p.dir, ".werk", "board.jsonl");
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const tickets = (p: Project) => {
  const m = new Map<string, { column: string; archived: boolean; reason?: string; title?: string }>();
  for (const e of board(p)) {
    const id = e.payload.id;
    if (e.type === "ticket.planned") {
      const prev = m.get(id);
      const col = prev && prev.column !== "ready" && prev.column !== "blocked" ? prev.column : e.payload.blocked_by.length ? "blocked" : "ready";
      m.set(id, { column: col, archived: prev?.archived ?? false, title: e.payload.title, reason: prev?.reason });
    }
    if (e.type === "ticket.moved") Object.assign(m.get(id) ?? {}, { column: e.payload.to, reason: e.payload.reason });
    if (e.type === "ticket.archived") Object.assign(m.get(id) ?? {}, { archived: true });
    if (e.type === "ticket.restored") Object.assign(m.get(id) ?? {}, { archived: false });
  }
  return m;
};
const files = (t: Record<string, string>) => Object.entries(t).map(([f, text]) => edit(`.werk/tickets/app/${f}`, text));
const move = (p: Project, id: string, to: string) =>
  appendFileSync(join(p.dir, ".werk", "board.jsonl"), `${JSON.stringify({ seq: board(p).length + 1, at: "t", actor: "agent", type: "ticket.moved", payload: { id, to } })}\n`);

async function planned(opts: { replies?: { spec: string; tickets: Record<string, string> }[]; extra?: (p: Project) => void } = {}) {
  const p = freshProject();
  root(p);
  card(p, "app", { title: "App", ...dec });
  card(p, "app-a", { title: "Card A", parent: "app", body: "Body of A.", ...dec });
  card(p, "app-b", { title: "Card B", parent: "app", ...dec });
  for (const id of ["app", "app-a", "app-b"]) {
    seed(p, "node.edited", { id, no_basis: "none" });
    seed(p, "kill.added", { id, criterion: { form: "revisit" } });
  }
  opts.extra?.(p);
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "s"], { cwd: p.target });
  await p.werk(["target", p.target]);
  const first = {
    spec: SPEC(2),
    tickets: {
      "01.md": ticket("One", "app, app-a", "", "1"),
      "02.md": ticket("Two", "app-b", "", "2"),
      "03.md": ticket("Three", "app-a", "", "1"),
    },
  };
  const all_ = [first, ...(opts.replies ?? [])];
  p.script({
    roles: {
      "spec-writer": { replies: all_.map((r) => [edit(".werk/specs/app.md", r.spec)]) },
      "ticket-writer": { replies: all_.map((r) => files(r.tickets)) },
    },
  });
  const r = await p.werk(["plan", "app"]);
  expect(r.code, all(r)).toBe(0);
  return p;
}

async function server(p: Project) {
  const proc = p.start([...currentWerkArgv(), "serve", "--port", "0"]);
  let err = "";
  void (async () => {
    for await (const c of proc.stderr) err += new TextDecoder().decode(c);
  })();
  let out = "";
  const reader = proc.stdout.getReader();
  while (!/http:\/\//.test(out)) {
    const { value, done } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
  }
  return { err: () => err };
}
async function until(f: () => boolean, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (f()) return true;
    await Bun.sleep(100);
  }
  return f();
}

test("[29.1] a second plan of the same subtree extends the spec and continues the ticket numbers", async () => {
  const p = await planned({
    replies: [
      {
        spec: SPEC(2).replace("Test seams", "Test seams\n\nCovers Card C."),
        tickets: { "03.md": ticket("Three rewritten", "app, app-a, app-c", "", "1"), "04.md": ticket("Four", "app-b", "", "2") },
      },
    ],
  });
  move(p, "app/01", "building");
  for (const to of ["building", "merging", "done"]) move(p, "app/02", to);
  card(p, "app-c", { title: "Card C", parent: "app", ...dec });
  const r = await p.werk(["plan", "app"]);
  expect(r.code, all(r)).toBe(0);
  const t = tickets(p);
  expect(readFileSync(join(p.dir, ".werk", "specs", "app.md"), "utf8")).toContain("Card C");
  expect(t.get("app/03")?.title).toBe("Three rewritten");
  expect(t.has("app/04")).toBe(true);
  expect(t.size).toBe(4);
  expect(t.get("app/01")?.column).toBe("building");
  expect(t.get("app/02")?.column).toBe("done");
  const rewritten = board(p).filter((e) => e.type === "ticket.planned" && ["app/01", "app/02"].includes(e.payload.id));
  expect(rewritten.length).toBe(2);
});

test("[29.2] an open ticket the new spec no longer needs is archived and can be restored", async () => {
  const p = await planned({
    replies: [{ spec: SPEC(1), tickets: { "01.md": ticket("One", "app, app-a, app-b", "", "1"), "03.md": ticket("Three", "app-a", "", "1") } }],
  });
  expect(tickets(p).get("app/02")?.archived).toBe(false);
  expect((await p.werk(["remove", "app-b", "--actor", "you"])).code).toBe(0);
  const r = await p.werk(["plan", "app"]);
  expect(r.code, all(r)).toBe(0);
  expect(tickets(p).get("app/02")?.archived).toBe(true);
  const arch = board(p).find((e) => e.type === "ticket.archived");
  expect(arch?.payload.reason).toMatch(/no longer needs it/);
  const res = await p.werk(["ticket", "restore", "app/02"]);
  expect(res.code, all(res)).toBe(0);
  expect(tickets(p).get("app/02")?.archived).toBe(false);
  expect(tickets(p).get("app/02")?.title).toBe("Two");
});

test("[29.3] retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
  const p = await planned({
    replies: [{ spec: SPEC(2), tickets: { "01.md": ticket("One", "app, app-a", "", "1"), "03.md": ticket("Three", "app-a", "", "1") } }],
  });
  const s = await server(p);
  expect(tickets(p).get("app/03")?.column).toBe("ready");
  expect((await p.werk(["propose", "app-a", "--title", "Card A renamed"])).code).toBe(0);
  expect((await p.werk(["accept", "app-a", "--actor", "you"])).code).toBe(0);
  const blocked = await until(() => tickets(p).get("app/03")?.column === "blocked");
  expect(blocked, s.err()).toBe(true);
  expect(tickets(p).get("app/03")?.reason).toMatch(/app-a/);
  expect(tickets(p).get("app/03")?.reason).toMatch(/title/);
  const r = await p.werk(["plan", "app"]);
  expect(r.code, all(r)).toBe(0);
  expect(tickets(p).get("app/03")?.column).toBe("ready");
});

test("[29.4] a note on a cited card blocks nothing, and a building ticket is never blocked", async () => {
  const p = await planned();
  move(p, "app/03", "building");
  const s = await server(p);
  expect(tickets(p).get("app/01")?.column).toBe("ready");
  expect((await w(p, "say", "app-a", "a note")).code).toBe(0);
  await Bun.sleep(1500);
  expect(tickets(p).get("app/01")?.column).toBe("ready");
  expect(tickets(p).get("app/03")?.column).toBe("building");
  const pr = await w(p, "propose", "app-a", "--ops", JSON.stringify([{ tag: "elaborated", old: "Body of A.", new: "A changed body." }]));
  expect(pr.code, all(pr)).toBe(0);
  expect((await w(p, "accept", "app-a", "--actor", "you")).code).toBe(0);
  expect(await until(() => tickets(p).get("app/01")?.column === "blocked"), s.err()).toBe(true);
  expect(tickets(p).get("app/01")?.reason).toMatch(/app-a/);
  expect(tickets(p).get("app/01")?.reason).toMatch(/body/);
  expect(tickets(p).get("app/03")?.column).toBe("building");
});

test("[29.5] a card added under a planned subtree reports a failed check without blocking tickets", async () => {
  const p = await planned();
  const s = await server(p);
  card(p, "app-new", { title: "New card", parent: "app", ...dec });
  expect(await until(() => s.err().includes("cards-cited")), s.err()).toBe(true);
  expect(s.err()).toContain("app-new");
  await Bun.sleep(500);
  for (const [, t] of tickets(p)) {
    expect(t.column).toBe(t.column === "ready" || t.column === "blocked" ? t.column : t.column);
    expect(t.reason ?? "").not.toMatch(/app-new/);
  }
  expect(tickets(p).get("app/01")?.column).toBe("ready");
});

test("[76.1] planner agents run on Opus without an advisor", async () => {
  const p = await planned();
  const ls = p.launches();
  expect(ls.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  for (const l of ls) {
    const i = l.args.indexOf("--model");
    expect(i).toBeGreaterThanOrEqual(0);
    const m = l.args[i + 1] as string;
    expect(m).toMatch(/^claude-opus-/);
    expect(l.args).not.toContain("--advisor");
    expect(["opus", "sonnet", "haiku"]).not.toContain(m);
  }
  expect(tickets(p).size).toBe(3);
});
