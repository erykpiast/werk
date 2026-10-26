import { afterEach, beforeEach, expect, test } from "bun:test";
import { type World, child, decided, open, world } from "./support.ts";

let w: World;
beforeEach(() => {
  w = world();
});
afterEach(() => w.project.dispose());

const spoken = (text: string) => ({
  speaker: "person",
  at: "10:02",
  session: "6ae61be7",
  kind: "spoken",
  text,
});

test("06.1 a new excerpt stages as a ghost and the link is pending", async () => {
  w.seed(decided("x", { title: "We charge per seat" }));
  w.chat("pricing", spoken("do we bill per seat?"), spoken("yes: seats are the unit we bill"));
  const before = (await w.werk("show", "x")).stdout;
  const r = await w.werk("quote", "x", "pricing", "seats are the unit we bill");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("proposed");
  expect(r.stdout).not.toContain("added");
  const ex = (await w.werk("show", "x:ex0")).stdout;
  expect(ex).toContain("proposed");
  const card = (await w.werk("show", "x")).stdout;
  expect(card).toMatch(/\[held\]|pending|proposed/);
  expect(card).toContain("[decided]");
  expect(card).toContain("We charge per seat");
  expect(card.split("\n").slice(0, 2)).toEqual(before.split("\n").slice(0, 2));
});

test("06.2 an accepted excerpt is no ghost and its link is live", async () => {
  w.seed(decided("x", { title: "We charge per seat" }));
  w.chat("pricing", spoken("yes: seats are the unit we bill"));
  await w.werk("quote", "x", "pricing", "seats are the unit we bill");
  const a = await w.werk("accept", "x:ex0", "--actor", "you");
  expect(a.code).toBe(0);
  const ex = (await w.werk("show", "x:ex0")).stdout;
  expect(ex).not.toContain("proposed");
  const card = (await w.werk("show", "x")).stdout;
  expect(card).toContain("supported_by");
  expect(card).not.toContain("[held]");
  // card view, read through the running server
  const { startBrowserServer } = await import("../e2e/support/server.ts");
  const { mkdirSync, appendFileSync, writeFileSync } = await import("node:fs");
  const { basename } = await import("node:path");
  const server = await startBrowserServer({});
  await server.start();
  try {
    const lines = decided("x", { title: "We charge per seat", parent: "root" })
      .map((e) => `${JSON.stringify(e)}\n`)
      .join("");
    appendFileSync(`${server.dir}/.werk/log.jsonl`, lines);
    mkdirSync(`${server.dir}/.werk/chats`, { recursive: true });
    writeFileSync(
      `${server.dir}/.werk/chats/pricing.jsonl`,
      `${JSON.stringify(spoken("yes: seats are the unit we bill"))}\n`,
    );
    expect(server.werk("quote", "x", "pricing", "seats are the unit we bill").code).toBe(0);
    expect(server.werk("accept", "x:ex0", "--actor", "you").code).toBe(0);
    const res = await fetch(`${server.origin}/api/projects/${basename(server.dir)}/open?card=x`);
    const html = JSON.stringify(await res.json());
    expect(html).toContain("seats are the unit we bill");
  } finally {
    await server.dispose();
  }
});

const tree = () =>
  w.seed(
    decided("auth", { title: "Auth" }),
    child("login", "auth", { title: "Login" }),
    child("session", "auth", { title: "Session" }),
    open("audit", { title: "Audit" }),
    { type: "edge.added", from: "login", to: "audit", link: "depends_on", why: "login audits" },
  );
const shows = async (id: string) => (await w.werk("show", id)).code === 0;

test("08.1 remove takes the subtree out in one step and restore brings it back", async () => {
  tree();
  const n = w.logLines();
  const r = await w.werk("remove", "auth", "--actor", "you");
  expect(r.code, r.stderr).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(await shows(id)).toBe(false);
  expect(w.logLines()).toBe(n + 1);
  const removed = await w.werk("removed");
  expect(removed.code, removed.stderr).toBe(0);
  expect(removed.stdout).toContain("auth");
  expect(removed.stdout).toContain("login");
  expect(removed.stdout).toContain("session");
  expect((await w.werk("show", "audit")).stdout).not.toContain("login");
  const back = await w.werk("restore", "auth", "--actor", "you");
  expect(back.code, back.stderr).toBe(0);
  expect((await w.werk("show", "auth")).stdout).toContain("login");
  expect((await w.werk("show", "audit")).stdout).toContain("login");
  expect((await w.werk("removed")).stdout.trim()).toBe("");
});

test("08.2 remove --reparent moves children up and restore puts them back", async () => {
  w.seed(
    decided("platform"),
    child("auth", "platform"),
    child("login", "auth"),
    child("session", "auth"),
  );
  const r = await w.werk("remove", "auth", "--actor", "you", "--reparent");
  expect(r.code, r.stderr).toBe(0);
  expect(await shows("auth")).toBe(false);
  const p = (await w.werk("show", "platform")).stdout;
  expect(p).toContain("login");
  expect(p).toContain("session");
  const back = await w.werk("restore", "auth", "--actor", "you");
  expect(back.code, back.stderr).toBe(0);
  const p2 = (await w.werk("show", "platform")).stdout;
  expect(p2).toContain("auth");
  expect(p2).not.toMatch(/<- refines\s+login/);
  expect((await w.werk("show", "auth")).stdout).toMatch(/<- refines\s+login/);
});

test("08.3 a link waits until both ends are back", async () => {
  w.seed(
    decided("root"),
    child("a", "root"),
    child("b", "root"),
    child("login", "a"),
    child("session", "b"),
    { type: "edge.added", from: "login", to: "session", link: "depends_on", why: "w" },
  );
  expect((await w.werk("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await w.werk("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await w.werk("restore", "login", "--actor", "you")).code).toBe(0);
  const l = (await w.werk("show", "login")).stdout;
  expect(l).toContain("login");
  expect(l).not.toContain("depends_on");
  expect((await w.werk("restore", "session", "--actor", "you")).code).toBe(0);
  expect((await w.werk("show", "login")).stdout).toContain("depends_on");
});

test("08.4 a removed card's id stays taken and a cited source stays", async () => {
  w.seed(
    decided("login"),
    decided("billing"),
    { type: "node.proposed", id: "rfc-6749", kind: "source", title: "RFC 6749", status: "open" },
    { type: "node.accepted", id: "rfc-6749", actor: "you" },
    { type: "edge.added", from: "login", to: "rfc-6749", link: "supported_by", why: "w" },
    { type: "edge.added", from: "billing", to: "rfc-6749", link: "supported_by", why: "w" },
  );
  expect((await w.werk("remove", "login", "--actor", "you")).code).toBe(0);
  const s = await w.werk("show", "rfc-6749");
  expect(s.code).toBe(0);
  expect(s.stdout).toContain("billing");
  const add = await w.werk("add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toMatch(/restore/);
  expect(add.stderr).toContain("login");
  expect((await w.werk("show", "login")).code).not.toBe(0);
});

test("08.5 remove without --actor you refuses", async () => {
  w.seed(decided("login"));
  const n = w.logLines();
  const r = await w.werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(w.logLines()).toBe(n);
});

test("08.6 restore without --actor you refuses", async () => {
  w.seed(decided("login"));
  expect((await w.werk("remove", "login", "--actor", "you")).code, "setup: remove --actor you").toBe(0);
  const n = w.logLines();
  const r = await w.werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(w.logLines()).toBe(n);
});
