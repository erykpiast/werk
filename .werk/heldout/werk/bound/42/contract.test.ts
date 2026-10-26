import { expect, test } from "bun:test";
import { mk } from "./h.ts";

const all = (r: { out: string; err: string }) => r.out + r.err;
const first = (s: string) => s.split("\n")[0] ?? "";

/** Run a printed command line such as `werk kill x --revisit`. */
async function runPrinted(h: ReturnType<typeof mk>, line: string) {
  const args = [...line.trim().matchAll(/"([^"]*)"|(\S+)/g)].map((x) => x[1] ?? x[2] ?? "");
  expect(args[0]).toBe("werk");
  return h.w(...args.slice(1));
}

function fullCard(h: ReturnType<typeof mk>, id: string, body?: string) {
  h.real("basis", "Basis");
  h.decide("basis");
  h.real(id, `Card ${id}`, undefined, { who: "you", ...(body ? { body } : {}) });
  h.edge(id, "basis", "depends_on", "uses basis");
  h.seed("node.added", { id: `${id}:opt0`, kind: "option", title: "Alt", why_not: "lost" });
  h.edge(`${id}:opt0`, id, "alternative_to");
  h.seed("kill.added", { id, criterion: { form: "revisit" } });
  h.decide(id);
}

test("[64.1] lacking kill criterion: refused, printed command fixes it", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("basis", "Basis", "root");
  h.decide("basis");
  h.decide("root");
  h.real("c", "Card", "root", { who: "you" });
  h.edge("c", "basis", "depends_on", "uses basis");
  h.seed("node.added", { id: "c:opt0", kind: "option", title: "Alt", why_not: "lost" });
  h.edge("c:opt0", "c", "alternative_to");
  const n = h.count();
  const r = await h.w("status", "c", "decided");
  console.log(all(r));
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("kill criterion");
  expect(all(r)).toMatch(/werk kill c /);
  expect(first(await h.out("show", "c"))).toContain("[open]");
  expect(h.count()).toBe(n);
  const printed = all(r)
    .split("\n")
    .map((l) => l.replace(/^\s*(or:\s*)?/, ""))
    .filter((l) => l.startsWith("werk kill c ") && !/</.test(l));
  expect(printed.length).toBeGreaterThan(0);
  expect((await runPrinted(h, printed[0] as string)).code).toBe(0);
  expect((await h.w("status", "c", "decided")).code).toBe(0);
  expect(first(await h.out("show", "c"))).toContain("[decided]");
});

test("[64.2] several missing facts, each with its own command", async () => {
  const h = mk();
  h.real("basis", "Basis");
  h.decide("basis");
  h.real("c", "Card", undefined, { body: "text" });
  const r = await h.w("status", "c", "decided");
  const o = all(r);
  expect(r.code).not.toBe(0);
  expect(o).toMatch(/who:/);
  expect(o).toMatch(/basis:/);
  expect(o).toMatch(/option:/);
  expect(o).toMatch(/kill criterion:/);
  expect(o).toContain("werk edit c --who");
  expect(o).toContain("werk link c");
  expect(o).toContain("werk add c:opt0");
  expect(o).toContain("werk kill c");
  expect(first(await h.out("show", "c"))).toContain("[open]");
  expect((await h.w("edit", "c", "--who", "you")).code).toBe(0);
  expect((await h.w("link", "c", "basis", "--type", "depends_on", "--why", "uses basis")).code).toBe(0);
  expect((await h.w("add", "c:opt0", "--kind", "option", "--title", "Alt", "--why_not", "lost")).code).toBe(0);
  expect((await h.w("link", "c:opt0", "c", "--type", "alternative_to")).code).toBe(0);
  expect((await h.w("accept", "c:opt0", "--actor", "you")).code).toBe(0);
  expect((await h.w("kill", "c", "--revisit")).code).toBe(0);
  const d = await h.w("status", "c", "decided");
  console.log(all(d));
  expect(d.code).toBe(0);
  expect(first(await h.out("show", "c"))).toContain("[decided]");
});

test("[64.3] a ghost obeys the same check through held edges", async () => {
  const h = mk();
  h.real("basis", "Basis");
  h.decide("basis");
  await h.w("add", "g1", "--title", "Ghost one");
  await h.w("edit", "g1", "--who", "you");
  await h.w("link", "g1", "basis", "--type", "depends_on", "--why", "b");
  await h.w("add", "g1:opt0", "--kind", "option", "--title", "Alt", "--why_not", "lost");
  await h.w("link", "g1:opt0", "g1", "--type", "alternative_to");
  await h.w("kill", "g1", "--revisit");
  const a = await h.w("status", "g1", "decided");
  console.log(all(a));
  expect(a.code).toBe(0);
  expect(first(await h.out("show", "g1"))).toContain("[decided]");
  await h.w("add", "g2", "--title", "Ghost two");
  await h.w("edit", "g2", "--who", "you");
  await h.w("add", "g2:opt0", "--kind", "option", "--title", "Alt", "--why_not", "lost");
  await h.w("link", "g2:opt0", "g2", "--type", "alternative_to");
  await h.w("kill", "g2", "--revisit");
  const b = await h.w("status", "g2", "decided");
  expect(b.code).not.toBe(0);
  expect(all(b)).toContain("basis");
  expect(all(b)).toContain("werk link g2");
  expect(first(await h.out("show", "g2"))).not.toContain("[decided]");
});

test("[64.4] an amend that removes a required fact is refused", async () => {
  const h = mk();
  fullCard(h, "c");
  const before = await h.out("show", "c");
  const n = h.count();
  const r = await h.w("unlink", "c", "basis", "--type", "depends_on");
  console.log("unlink:", all(r));
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("basis");
  expect(all(r)).toMatch(/werk link c/);
  expect(h.count()).toBe(n);
  expect(await h.out("show", "c")).toBe(before);
  expect(first(before)).toContain("[decided]");
});

test("[64.5] an amend that keeps every fact succeeds", async () => {
  const h = mk();
  fullCard(h, "c", "The old long body of the card.");
  const p = await h.w("propose", "c", "--ops", JSON.stringify([{ tag: "elaborated", old: "The old long body of the card.", new: "One short sentence." }]));
  console.log(all(p));
  expect(p.code).toBe(0);
  const a = await h.w("accept", "c", "--actor", "you");
  console.log(all(a));
  expect(a.code).toBe(0);
  const s = await h.out("show", "c");
  expect(first(s)).toContain("[decided]");
  expect(s).toContain("One short sentence.");
  const types = h.events().map((e) => e.type);
  const tail = types.slice(-4);
  console.log(tail);
  expect(types.lastIndexOf("node.reopened")).toBeGreaterThan(-1);
  expect(types.lastIndexOf("node.decided")).toBeGreaterThan(types.lastIndexOf("node.reopened"));
});
