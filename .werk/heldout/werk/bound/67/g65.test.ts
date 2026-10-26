// Held-out steps 65.1-65.5: a reopen marks cards stale or paused; rederive and a decide clear them.
import { expect, test } from "bun:test";
import { make, type P } from "./lib.ts";

function root(p: P): void {
  p.card("root", { title: "Root", status: "decided", who: "me" });
}
function card(p: P, id: string, status = "decided", parent = "root"): void {
  p.card(id, { title: `Card ${id}`, status, who: "me", parent });
}
function dep(p: P, from: string, to: string): void {
  p.seed("edge.added", { from, to, type: "depends_on", why: `${from} reads ${to}` });
}
/** The entries of the stale list: kind, id and the lines under it. */
async function staleList(p: P): Promise<{ kind: string; id: string; text: string }[]> {
  const out = (await p.w("stale")).out;
  const entries: { kind: string; id: string; text: string }[] = [];
  for (const line of out.split("\n")) {
    const head = /^(\w+)\s+(\S+)\s/.exec(line);
    if (head) entries.push({ kind: head[1] as string, id: head[2] as string, text: line });
    else if (entries.length > 0) (entries.at(-1) as { text: string }).text += `\n${line}`;
  }
  return entries;
}
const head = async (p: P, id: string) => (await p.w("show", id)).out.split("\n")[0] as string;

test("65.1 a rejected reopen marks only the next hop as stale", async () => {
  const p = make();
  root(p);
  for (const id of ["a", "b", "c"]) card(p, id);
  dep(p, "b", "a");
  dep(p, "c", "b");
  expect((await p.w("reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong")).code).toBe(0);
  const list = await staleList(p);
  const b = list.find((e) => e.id === "b");
  expect(b?.kind).toBe("stale");
  expect(b?.text).toContain("#a");
  expect(b?.text).toContain("rejected");
  expect(b?.text).toMatch(/depends_on/);
  expect(list.find((e) => e.id === "c")).toBeUndefined();
  const c = await head(p, "c");
  expect(c).not.toContain("stale");
  expect(c).not.toContain("paused");
});

test("65.2 a postponed reopen pauses every downstream card and keeps their status", async () => {
  const p = make();
  root(p);
  for (const id of ["a", "b", "c", "d"]) card(p, id);
  dep(p, "b", "a");
  dep(p, "c", "b");
  dep(p, "d", "c");
  expect(
    (await p.w("reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter")).code,
  ).toBe(0);
  for (const id of ["b", "c", "d"]) expect(await head(p, id)).toContain("paused");
  expect(await head(p, "d")).toContain("[decided]");
  const list = await staleList(p);
  const d = list.find((e) => e.id === "d");
  expect(d?.kind).toBe("paused");
  expect(d?.text).toContain("#a");
  expect(d?.text).toContain("postponed");
  for (const id of ["a", "b", "c", "d"]) expect(await head(p, id)).not.toContain("stale");
  expect(list.some((e) => e.kind === "stale")).toBe(false);
});

test("65.3 stale wins when a postponement and a rejection reach the same card", async () => {
  const p = make();
  root(p);
  card(p, "a");
  card(p, "b");
  card(p, "c", "decided", "b");
  dep(p, "c", "a");
  expect((await p.w("reopen", "a", "--reason", "postponed", "--why", "later")).code).toBe(0);
  expect((await p.w("reopen", "b", "--reason", "rejected", "--why", "wrong")).code).toBe(0);
  const c = await head(p, "c");
  expect(c).toContain("stale");
  expect(c).not.toContain("paused");
  const entry = (await staleList(p)).find((e) => e.id === "c");
  expect(entry?.kind).toBe("stale");
  expect(entry?.text).toContain("#b");
  expect(entry?.text).toContain("rejected");
});

test("65.4 rederive clears the mark on one card and leaves the others", async () => {
  const p = make();
  root(p);
  for (const id of ["a", "b", "c"]) card(p, id);
  dep(p, "b", "a");
  dep(p, "c", "a");
  expect((await p.w("reopen", "a", "--reason", "rejected", "--why", "wrong")).code).toBe(0);
  let list = await staleList(p);
  expect(list.find((e) => e.id === "b")?.kind).toBe("stale");
  expect(list.find((e) => e.id === "c")?.kind).toBe("stale");
  const r = await p.w("rederive", "b", "--confirm", "a");
  expect({ code: r.code, err: r.err }).toMatchObject({ code: 0 });
  list = await staleList(p);
  expect(list.find((e) => e.id === "b")).toBeUndefined();
  const c = list.find((e) => e.id === "c");
  expect(c?.kind).toBe("stale");
  expect(c?.text).toContain("#a");
  expect(c?.text).toContain("rejected");
  expect(await head(p, "b")).not.toContain("stale");
});

test("65.5 deciding a postponed card again clears the paused marks downstream", async () => {
  const p = make();
  root(p);
  card(p, "a");
  card(p, "b");
  card(p, "c", "open");
  dep(p, "b", "a");
  dep(p, "c", "b");
  // A has every fact of the contract check, so a decide of it can pass.
  p.seed("node.added", { id: "a:opt0", kind: "option", title: "Another way", why_not: "Slower" });
  p.seed("edge.added", { from: "a:opt0", to: "a", type: "alternative_to" });
  expect((await p.w("kill", "a", "--revisit")).code).toBe(0);
  expect((await p.w("reopen", "a", "--reason", "postponed", "--why", "later")).code).toBe(0);
  expect(await head(p, "b")).toContain("paused");
  expect(await head(p, "c")).toContain("paused");
  const r = await p.w("status", "a", "decided");
  expect({ code: r.code, err: r.err }).toMatchObject({ code: 0 });
  expect(await head(p, "b")).not.toContain("paused");
  expect(await head(p, "c")).not.toContain("paused");
  const list = await staleList(p);
  expect(list.find((e) => e.id === "b")).toBeUndefined();
  expect(list.find((e) => e.id === "c")).toBeUndefined();
  expect(await head(p, "c")).toContain("[open]");
});
