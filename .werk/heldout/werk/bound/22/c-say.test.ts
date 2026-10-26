import { afterEach, expect, test } from "bun:test";
import { cleanupAll, project } from "./cli.ts";
afterEach(cleanupAll);

/** The inbox text split into groups, keyed by the card id each block names. */
function group(out: string, id: string): string {
  // a group is the part of the output from the line naming #id to the next line naming another card id
  const lines = out.split("\n");
  const kept: string[] = [];
  let cur: string | undefined;
  for (const l of lines) {
    const m = /#([a-z0-9:-]+)/.exec(l);
    if (m && /^\S/.test(l)) cur = m[1];
    if (cur === id) kept.push(l);
  }
  return kept.join("\n");
}

test("68.1 say writes a note shown on the card", () => {
  const p = project();
  p.card("root", "Root");
  p.card("werk-chat", "The composer sends a live agent turn", { parent: "root", status: "decided" });
  const n = p.lines().length;
  const r = p.werk("say", "#werk-chat", "The reply streams over SSE");
  expect(r.code).toBe(0);
  const ev = p.events();
  expect(ev.length).toBe(n + 1);
  expect(ev.at(-1)?.type).toBe("note.added");
  expect(ev.at(-1)?.payload.id).toBe("werk-chat");
  expect(p.werk("show", "#werk-chat").out).toContain("The reply streams over SSE");
});

test("68.2 inbox reads a thread in order", () => {
  const p = project();
  p.card("root", "Root");
  p.card("werk-chat", "Chat", { parent: "root" });
  for (const t of ["first", "second", "third"]) expect(p.werk("say", "werk-chat", t).code).toBe(0);
  const out = p.werk("inbox").out;
  const g = group(out, "werk-chat");
  expect(g).not.toBe("");
  const i = ["first", "second", "third"].map((t) => g.indexOf(t));
  expect(i.every((x) => x >= 0)).toBe(true);
  expect(i[0]! < i[1]! && i[1]! < i[2]!).toBe(true);
});

test("68.3 inbox groups notes by card", () => {
  const p = project();
  p.card("root", "Root");
  p.card("werk-chat", "Chat", { parent: "root" });
  p.card("visual", "Visual", { parent: "root" });
  p.werk("say", "werk-chat", "chat one");
  p.werk("say", "visual", "visual one");
  p.werk("say", "werk-chat", "chat two");
  const out = p.werk("inbox").out;
  const chat = group(out, "werk-chat");
  const vis = group(out, "visual");
  expect(chat.indexOf("chat one")).toBeGreaterThanOrEqual(0);
  expect(chat.indexOf("chat two")).toBeGreaterThan(chat.indexOf("chat one"));
  expect(vis).toContain("visual one");
  expect(vis).not.toContain("chat one");
  expect(vis).not.toContain("chat two");
});

test("68.4 note on a ghost card", () => {
  const p = project();
  p.card("root", "Root");
  p.card("visual", "Visual", { parent: "root" });
  expect(p.werk("add", "werk-pane", "--title", "The pane", "--parent", "root").code).toBe(0);
  p.werk("link", "visual", "werk-pane", "--type", "depends_on", "--why", "the visual sits in the pane");
  const r = p.werk("say", "werk-pane", "Describe the pane here");
  expect(r.code, r.all).toBe(0);
  const g = group(p.werk("inbox").out, "werk-pane");
  expect(g).toContain("Describe the pane here");
});

test("68.5 note on unknown card fails", () => {
  const p = project();
  p.card("root", "Root");
  p.card("werk-chat", "Chat", { parent: "root" });
  const size = p.raw().length;
  const r = p.werk("say", "#no-such-card", "lost note");
  expect(r.code).not.toBe(0);
  expect(r.all).toContain("no-such-card");
  expect(r.all).toMatch(/unknown|not in the map|no node/i);
  expect(p.raw().length).toBe(size);
  expect(p.werk("inbox").out).not.toContain("lost note");
});
