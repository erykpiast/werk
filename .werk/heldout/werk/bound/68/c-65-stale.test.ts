import { expect, test } from "bun:test";
import { cardView, decided, header, link, ok, seeded, werk } from "./c-helpers.ts";

const T = 60_000;

/** The entry of one card in `werk stale`: its line and the trace line under it. */
function entry(list: string, id: string): string {
  const rows = list.split("\n");
  const i = rows.findIndex((r) => new RegExp(`^\\S+\\s+${id}\\s`).test(r));
  if (i < 0) return "";
  return `${rows[i]}\n${rows[i + 1] ?? ""}`;
}

/** A card A that can be decided again: who, a waived basis, an option and a kill criterion. */
const decidable = (id: string, title: string) => [
  decided(id, title, "root"),
  ["node.edited", { id, no_basis: "A is a first choice" }] as [string, Record<string, unknown>],
  ["node.added", { id: `${id}-opt`, kind: "option", title: "Other", why_not: "slower" }] as [
    string,
    Record<string, unknown>,
  ],
  link(`${id}-opt`, id, "alternative_to"),
  ["kill.added", { id, criterion: { form: "revisit" } }] as [string, Record<string, unknown>],
];

test(
  "65.1 a rejected reopen marks only the next hop as stale",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      ...decidable("a", "A"),
      decided("b", "B", "root"),
      decided("c", "C", "root"),
      link("b", "a", "depends_on", "B stores in A"),
      link("c", "b", "depends_on", "C reads B"),
    ]);
    await ok(p, "reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong");
    const list = await ok(p, "stale");
    const b = entry(list, "b");
    expect(b).toMatch(/^stale/);
    expect(b).toContain("#a");
    expect(b).toContain("rejected");
    expect(b).toContain("depends_on");
    expect(entry(list, "c")).toBe("");
    const showC = await ok(p, "show", "c");
    expect(header(showC)).not.toMatch(/stale|paused/);
    expect(cardView(p, "c")?.marks ?? []).toEqual([]);
  },
  T,
);

test(
  "65.2 a postponed reopen pauses every downstream card and keeps their status",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      ...decidable("a", "A"),
      decided("b", "B", "root"),
      decided("c", "C", "root"),
      decided("d", "D", "root"),
      link("b", "a", "depends_on", "w"),
      link("c", "b", "depends_on", "w"),
      link("d", "c", "depends_on", "w"),
    ]);
    await ok(p, "reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter");
    for (const id of ["b", "c", "d"]) expect(header(await ok(p, "show", id))).toContain("paused");
    expect(header(await ok(p, "show", "d"))).toContain("[decided]");
    const list = await ok(p, "stale");
    const d = entry(list, "d");
    expect(d).toMatch(/^paused/);
    expect(d).toContain("#a");
    expect(d).toContain("postponed");
    for (const id of ["a", "b", "c", "d"]) expect(header(await ok(p, "show", id))).not.toContain("stale");
    expect(list).not.toMatch(/^stale/m);
  },
  T,
);

test(
  "65.3 stale wins when a postponement and a rejection reach the same card",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      decided("a", "A", "root"),
      decided("b", "B", "root"),
      decided("c", "C", "b"),
      link("c", "a", "depends_on", "w"),
    ]);
    await ok(p, "reopen", "a", "--reason", "postponed");
    await ok(p, "reopen", "b", "--reason", "rejected");
    const h = header(await ok(p, "show", "c"));
    expect(h).toContain("stale");
    expect(h).not.toContain("paused");
    const c = entry(await ok(p, "stale"), "c");
    expect(c).toMatch(/^stale/);
    expect(c).toContain("#b");
    expect(c).toContain("rejected");
  },
  T,
);

test(
  "65.4 rederive clears the mark on one card and leaves the others",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      ...decidable("a", "A"),
      decided("b", "B", "root"),
      decided("c", "C", "root"),
      link("b", "a", "depends_on", "w"),
      link("c", "a", "depends_on", "w"),
    ]);
    await ok(p, "reopen", "a", "--reason", "rejected");
    let list = await ok(p, "stale");
    expect(entry(list, "b")).toMatch(/^stale/);
    expect(entry(list, "c")).toMatch(/^stale/);
    const run = await werk(p, "rederive", "b", "--confirm", "a");
    expect(run.code, `rederive b --confirm a: ${run.err}`).toBe(0);
    list = await ok(p, "stale");
    expect(entry(list, "b")).toBe("");
    const c = entry(list, "c");
    expect(c).toMatch(/^stale/);
    expect(c).toContain("#a");
    expect(c).toContain("rejected");
    expect(header(await ok(p, "show", "b"))).not.toContain("stale");
  },
  T,
);

test(
  "65.5 deciding a postponed card again clears the paused marks downstream",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      ...decidable("a", "A"),
      decided("b", "B", "root"),
      ["node.added", { id: "c", kind: "card", title: "C", parent: "root", status: "proto" }],
      link("b", "a", "depends_on", "w"),
      link("c", "b", "depends_on", "w"),
    ]);
    await ok(p, "reopen", "a", "--reason", "postponed");
    expect(header(await ok(p, "show", "b"))).toContain("paused");
    expect(header(await ok(p, "show", "c"))).toContain("paused");
    await ok(p, "status", "a", "decided");
    expect(header(await ok(p, "show", "b"))).not.toContain("paused");
    expect(header(await ok(p, "show", "c"))).not.toContain("paused");
    const list = await ok(p, "stale");
    expect(entry(list, "b")).toBe("");
    expect(entry(list, "c")).toBe("");
    expect(header(await ok(p, "show", "c"))).toContain("[proto]");
  },
  T,
);
