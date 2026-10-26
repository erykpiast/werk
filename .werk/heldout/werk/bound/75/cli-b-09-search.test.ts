import { expect, test } from "bun:test";
import { card, decided, dep, link, ok, withMap } from "./cli-b-helpers.ts";

test("09.1", async () => {
  const p = withMap([
    ...decided("d1", "First decided"),
    ...decided("d2", "Second decided"),
    ...decided("d3", "Third decided"),
    card("o1", "Open one"),
    ["node.proposed", { id: "g1", kind: "card", title: "Ghost one", who: "me", no_basis: "x" }],
    ["kill.added", { id: "g1", criterion: { form: "revisit" } }],
    ["node.decided", { id: "g1" }],
  ]);
  const out = (await ok(p, ["search"])).out;
  console.log(out);
  const rows = out.trimEnd().split("\n");
  expect(rows).toEqual(["d1  First decided", "d2  Second decided", "d3  Third decided"]);
  expect(out).not.toContain("o1");
  expect(out).not.toContain("g1");
});

test("09.2", async () => {
  const p = withMap([
    ...decided("layout", "Cache layout", { body: "Cache eviction is LRU.\n\nThe eviction policy is fixed." }),
    card("timer", "Eviction timer", { why: "The eviction runs on a timer.", body: "CACHE warmup first." }),
    ...decided("size", "Cache size", { body: "The cache holds 1 GB." }),
    card("gone", "Gone card", { body: "cache eviction" }),
    ["node.removed", { id: "gone" }],
  ]);
  const out = (await ok(p, ["search", "cache", "eviction"])).out;
  console.log(out);
  const rows = out.trimEnd().split("\n");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toBe("layout  decided  Cache layout");
  expect(rows[1]).toBe("timer  open  Eviction timer");
  expect(out).not.toContain("Cache size");
  expect(out).not.toContain("gone");
});

test("09.3", async () => {
  const p = withMap([
    ...decided("parent", "Parent topic"),
    ...decided("storage", "Storage format", { parent: "parent", no_basis: undefined }),
    ["node.added", { id: "storage:opt0", kind: "option", title: "Embedded DB", why_not: "SQLite needs a native build" }],
    link("storage:opt0", "storage", "alternative_to"),
    card("other", "Other card", { body: "We tried sqlite once." }),
  ]);
  const all = (await ok(p, ["search", "sqlite"])).out;
  console.log(all);
  expect(all).toContain("storage  decided  Storage format");
  expect(all).toContain("other  open  Other card");
  const under = (await ok(p, ["search", "sqlite", "--under", "parent"])).out;
  expect(under).toBe("storage  decided  Storage format\n");
  const dec = (await ok(p, ["search", "sqlite", "--status", "decided"])).out;
  expect(dec).toBe("storage  decided  Storage format\n");
});

test("09.4", async () => {
  const p = withMap([
    ...decided("other", "Other tree"),
    ...decided("pp", "Postponed basis", { parent: "other" }),
    ...decided("rr", "Rejected basis", { parent: "other" }),
    card("billing", "Billing", { parent: "other" }),
    ...decided("client", "Client"),
    card("routing", "Routing", { parent: "client" }),
    card("theme", "Theme", { parent: "client", status: "proto" }),
    card("guards", "Route guards", { parent: "routing" }),
    card("paused", "Paused card", { parent: "client" }),
    card("stale", "Stale card", { parent: "client" }),
    ...decided("later", "Postponed card", { parent: "client" }),
    dep("paused", "pp"),
    dep("stale", "rr"),
    ["node.added", { id: "routing:opt0", kind: "option", title: "Hash routes", why_not: "Ugly URLs" }],
    link("routing:opt0", "routing", "alternative_to"),
    ["node.added", { id: "src1", kind: "source", title: "Router survey" }],
    link("routing", "src1", "supported_by"),
    ["node.reopened", { id: "pp", reason: "postponed" }],
    ["node.reopened", { id: "rr", reason: "rejected" }],
    ["node.reopened", { id: "later", reason: "postponed" }],
  ]);
  const show = async (id: string) => (await ok(p, ["show", id])).out.split("\n")[0];
  console.log(await show("paused"), "|", await show("stale"), "|", await show("later"));
  const r = (await ok(p, ["find", "routing"])).out;
  console.log(r);
  const rows = r.trimEnd().split("\n").map((row) => row.split("  ")[0]);
  expect(rows).toEqual(["routing", "guards"]);
  expect(r).not.toContain("billing");
  expect(r).not.toContain("routing:opt0");
  expect(r).not.toContain("src1");
  const c = (await ok(p, ["find", "client"])).out;
  console.log(c);
  const ids = c.trimEnd().split("\n").map((row) => row.split("  ")[0]);
  expect(ids).toContain("routing");
  expect(ids).toContain("theme");
  expect(ids).toContain("guards");
  expect(ids.indexOf("routing")).toBeLessThan(ids.indexOf("guards"));
  expect(ids.indexOf("theme")).toBeLessThan(ids.indexOf("guards"));
  for (const gone of ["client", "paused", "stale", "later"]) expect(ids).not.toContain(gone);
});

test("09.5", async () => {
  const p = withMap([
    ...decided("t1", "Tree one"),
    card("o1", "Open in one", { parent: "t1" }),
    ...decided("t2", "Tree two"),
    card("o2", "Open in two", { parent: "t2" }),
    ...decided("auth", "Auth flow", { parent: "t2" }),
    ["node.reopened", { id: "auth", reason: "rejected" }],
  ]);
  const out = (await ok(p, ["find"])).out;
  console.log(out);
  const rows = out.trimEnd().split("\n");
  const ids = rows.map((row) => row.split("  ")[0]);
  expect(ids).toContain("o1");
  expect(ids).toContain("o2");
  expect(ids).toContain("auth");
  for (const row of rows) expect(row.split("  ")[1]).not.toBe("decided");
});
