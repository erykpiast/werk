import { expect, test } from "bun:test";
import { card, fresh, logLines, ok, seed } from "./cli-helpers.ts";

test("68.1 say then show", async () => {
  const p = fresh([card("werk-chat", "The composer sends a live agent turn", { parent: "root", status: "decided" })]);
  const n = logLines(p).length;
  const r = await p.werk(["say", "#werk-chat", "The reply streams over SSE"]);
  expect(r.code).toBe(0);
  const ls = logLines(p);
  expect(ls.length).toBe(n + 1);
  const ev = JSON.parse(ls.at(-1) as string);
  expect(ev.type).toBe("note.added");
  expect(ev.payload.id).toBe("werk-chat");
  expect((await ok(p, ["show", "#werk-chat"])).out).toContain("The reply streams over SSE");
});

test("68.2 inbox lists a thread in order", async () => {
  const p = fresh([card("werk-chat", "Chat", { parent: "root" })]);
  for (const t of ["first", "second", "third"]) await ok(p, ["say", "werk-chat", t]);
  const out = (await ok(p, ["inbox"])).out;
  expect(out).toContain("werk-chat");
  expect(out.indexOf("first")).toBeLessThan(out.indexOf("second"));
  expect(out.indexOf("second")).toBeLessThan(out.indexOf("third"));
  expect(out.match(/#werk-chat/g)?.length).toBe(1);
});

test("68.3 inbox groups by card", async () => {
  const p = fresh([card("werk-chat", "Chat", { parent: "root" }), card("visual", "Visual", { parent: "root" })]);
  await ok(p, ["say", "werk-chat", "chat one"]);
  await ok(p, ["say", "visual", "visual one"]);
  await ok(p, ["say", "werk-chat", "chat two"]);
  const out = (await ok(p, ["inbox"])).out;
  const vi = out.indexOf("#visual");
  const ch = out.indexOf("#werk-chat");
  expect(out.match(/#werk-chat/g)?.length).toBe(1);
  expect(out.match(/#visual/g)?.length).toBe(1);
  const [first, second] = ch < vi ? [out.slice(ch, vi), out.slice(vi)] : [out.slice(vi, ch), out.slice(ch)];
  const chat = ch < vi ? first : second;
  const visual = ch < vi ? second : first;
  expect(chat).toContain("chat one");
  expect(chat.indexOf("chat one")).toBeLessThan(chat.indexOf("chat two"));
  expect(visual).toContain("visual one");
  expect(visual).not.toContain("chat one");
  expect(visual).not.toContain("chat two");
});

test("68.4 note on a ghost", async () => {
  const p = fresh([
    card("visual", "Visual", { parent: "root" }),
    { type: "node.proposed", actor: "agent", payload: { id: "werk-pane", kind: "card", title: "Pane", parent: "root" } },
  ]);
  const r = await p.werk(["say", "werk-pane", "Describe the pane here"]);
  expect(r.code).toBe(0);
  const out = (await ok(p, ["inbox"])).out;
  expect(out).toContain("werk-pane");
  expect(out).toContain("Describe the pane here");
});

test("68.5 note on unknown card fails", async () => {
  const p = fresh([card("werk-chat", "Chat", { parent: "root" })]);
  const n = logLines(p).length;
  const r = await p.werk(["say", "#no-such-card", "lost note"]);
  expect(r.code).not.toBe(0);
  expect(r.err + r.out).toContain("no-such-card");
  expect(r.err + r.out).toMatch(/unknown/);
  expect(logLines(p).length).toBe(n);
  expect((await ok(p, ["inbox"])).out).not.toContain("lost note");
});
