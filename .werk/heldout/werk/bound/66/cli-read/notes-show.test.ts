import { expect, test } from "bun:test";
import { readMap } from "../../src/map/store.ts";
import { cardHtml } from "../../src/serve/card-html.ts";
import { card, chat, edge, events, logOf, ok, project, seed } from "./helpers.ts";

test("10.2 inbox lists the person's notes in order, after --since and capped by -n", async () => {
  const p = project();
  seed(p, [card("root", "Root"), card("auth-login", "Login uses magic links", { parent: "root" })]);
  // A note typed in the map is a note.added event in the person's name (the server's notes route).
  for (const text of ["first", "second", "third", "fourth"])
    seed(p, [{ type: "note.added", payload: { id: "auth-login", text } }]);
  const firstSeq = events(p).find((e) => e.payload.text === "first").seq;
  const all = (await ok(p, ["inbox"])).out;
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(`    ${t}`));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  for (const e of events(p).filter((e) => e.type === "note.added")) expect(all).toContain(`[${e.seq}] #auth-login`);
  const since = (await ok(p, ["inbox", "--since", String(firstSeq)])).out;
  expect(since).not.toContain("    first");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(`    ${t}`);
  const capped = (await ok(p, ["inbox", "--since", String(firstSeq), "-n", "2"])).out;
  expect(capped).toContain("    second");
  expect(capped).toContain("    third");
  expect(capped).not.toContain("    fourth");
  expect(capped).not.toContain("    first");
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async () => {
  const p = project();
  seed(p, [card("root", "Root")]);
  await ok(p, ["add", "cache-ttl", "--title", "Cache entries live 60 seconds"]);
  seed(p, [{ type: "note.added", payload: { id: "cache-ttl", text: "Why 60 seconds?" } }]);
  await ok(p, ["discard", "cache-ttl"]);
  const inbox = (await ok(p, ["inbox"])).out;
  expect(inbox).toContain("#cache-ttl");
  expect(inbox).toContain("Why 60 seconds?");
  await ok(p, ["add", "cache-ttl", "--title", "Cache entries live 5 minutes"]);
  // The thread in the map: the card HTML that the server's card read returns.
  const html = cardHtml(readMap("test", logOf(p)), "cache-ttl") ?? "";
  const note = html.indexOf("Why 60 seconds?");
  const markers = html.split('data-entry="marker"').length - 1;
  expect(note).toBeGreaterThanOrEqual(0);
  expect(markers).toBe(1);
  expect(note).toBeLessThan(html.indexOf('data-entry="marker"'));
});

function rollupOf(out: string) {
  const line = out.split("\n").find((l) => l.startsWith("subtree:")) ?? "";
  const n = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);
  return { line, cards: n("cards?"), open: n("open"), proto: n("proto"), decided: n("decided") };
}

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = project();
  seed(p, [
    card("root", "Root", { status: "decided" }),
    card("c1", "Child one", { parent: "root" }),
    card("c2", "Child two", { parent: "root", status: "proto" }),
    card("g1", "Grandchild", { parent: "c1", status: "decided" }),
  ]);
  const out = (await ok(p, ["show", "root"])).out;
  expect(out.split("\n").filter((l) => l.startsWith("subtree:"))).toHaveLength(1);
  const r = rollupOf(out);
  expect(r).toMatchObject({ cards: 4, open: 1, proto: 1, decided: 2 });
  expect(r.open + r.proto + r.decided).toBe(r.cards);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = project();
  seed(p, [
    card("root", "Root"),
    card("child", "Child", { parent: "root" }),
    card("g1", "Grand open", { parent: "child" }),
    card("g2", "Grand decided", { parent: "child", status: "decided" }),
  ]);
  const out = (await ok(p, ["show", "root"])).out;
  const link = out.split("\n").find((l) => l.includes("<- refines") && l.includes("child")) ?? "";
  expect(link).toContain("(3 cards");
  expect(rollupOf(out).cards).toBe(4);
});

function evidence(p: ReturnType<typeof project>) {
  chat(p, "talk", [
    { speaker: "person", at: "10:00", session: "s1", kind: "spoken", text: "SQLite is fast enough for us" },
  ]);
}

test("11.3 show prints options, excerpts and a proposed source with their words", async () => {
  const p = project();
  seed(p, [
    card("root", "Root", { status: "decided" }),
    card("base", "Base", { parent: "root", status: "decided" }),
    card("x", "Use SQLite", { parent: "root" }),
    edge("x", "base", "depends_on", "takes the storage budget"),
    {
      type: "node.added",
      payload: { id: "x:opt0", kind: "option", title: "Use Postgres", why_not: "too heavy to run" },
    },
    edge("x:opt0", "x", "alternative_to"),
  ]);
  evidence(p);
  await ok(p, ["quote", "x", "talk", "SQLite is fast enough"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Bench notes", "--finding", "SQLite wins reads"]);
  await ok(p, ["link", "x", "bench", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "x"])).out;
  const rows = out.split("\n");
  const dep = rows.findIndex((l) => l.includes("-> depends_on") && l.includes("base"));
  expect(dep).toBeGreaterThanOrEqual(0);
  expect(rows[dep + 1]).toContain("why: takes the storage budget");
  const lastLink = Math.max(...rows.map((l, i) => (/^\s+(->|<-) /.test(l) ? i : -1)));
  const opts = rows.indexOf("Options");
  expect(opts).toBeGreaterThan(lastLink);
  const optText = rows.slice(opts).join("\n");
  expect(optText).toContain("Use Postgres");
  expect(optText).toContain("too heavy to run");
  const say = rows.indexOf("Say");
  expect(say).toBeGreaterThan(lastLink);
  expect(rows.slice(say).join("\n")).toContain('person: "SQLite is fast enough"');
  const ev = rows.indexOf("Ev");
  expect(ev).toBeGreaterThan(lastLink);
  const evRows = rows.slice(ev);
  const src = evRows.find((l) => l.includes("Bench notes")) ?? "";
  expect(src).toContain("proposed");
  expect(evRows.join("\n")).toContain("SQLite wins reads");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = project();
  seed(p, [card("root", "Root"), card("x", "Use SQLite", { parent: "root" })]);
  evidence(p);
  await ok(p, ["quote", "x", "talk", "SQLite is fast enough"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Bench notes", "--finding", "SQLite wins reads"]);
  await ok(p, ["link", "x", "bench", "--type", "supported_by"]);
  const rows = (await ok(p, ["show", "x"])).out.split("\n");
  expect(rows).toContain("Say");
  expect(rows).toContain("Ev");
  expect(rows).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = project();
  seed(p, [card("root", "Root of all"), card("second", "Second card", { parent: "root" })]);
  const out = (await ok(p, ["show"])).out;
  expect(out).toContain("Root of all");
  expect(rollupOf(out).cards).toBe(2);
  const link = out.split("\n").find((l) => l.includes("<- refines") && l.includes("second")) ?? "";
  expect(link).toContain("(1 card");
});
