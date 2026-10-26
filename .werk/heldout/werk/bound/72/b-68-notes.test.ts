import { expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { decided, project } from "./b-helpers.ts";

/** The lines of the inbox group of a card: its header line and the lines below it, up to the next group. */
function group(out: string, id: string): string {
  const ls = out.split("\n");
  const at = ls.findIndex((l) => /^\S/.test(l) && l.includes(`#${id}`));
  if (at < 0) return "";
  const end = ls.findIndex((l, i) => i > at && /^\S/.test(l));
  return ls.slice(at, end < 0 ? undefined : end).join("\n");
}

test("68.1 an agent writes a note on a card and sees it on the card", async () => {
  const p = project();
  decided(p, "werk-chat", { title: "The composer sends a live agent turn" });
  const before = p.log().length;
  const r = await p.werk(["say", "#werk-chat", "The reply streams over SSE"]);
  expect(r.code).toBe(0);
  const added = p
    .log()
    .slice(before)
    .map((l) => JSON.parse(l));
  expect(added).toHaveLength(1);
  expect(added[0].type).toBe("note.added");
  expect(added[0].payload.id).toBe("werk-chat");
  expect(await p.must(["show", "#werk-chat"])).toContain("The reply streams over SSE");
});

test("68.2 an agent reads a whole card thread in order from the inbox", async () => {
  const p = project();
  decided(p, "werk-chat", { title: "Chat" });
  for (const text of ["first", "second", "third"]) await p.must(["say", "werk-chat", text]);
  const out = await p.must(["inbox"]);
  const g = group(out, "werk-chat");
  expect(g).not.toBe("");
  const i1 = g.indexOf("first");
  const i2 = g.indexOf("second");
  const i3 = g.indexOf("third");
  expect(i1).toBeGreaterThan(-1);
  expect(i2).toBeGreaterThan(i1);
  expect(i3).toBeGreaterThan(i2);
});

test("68.3 the inbox groups notes by card", async () => {
  const p = project();
  decided(p, "werk-chat", { title: "Chat" });
  decided(p, "visual", { title: "Visual" });
  await p.must(["say", "werk-chat", "chat one"]);
  await p.must(["say", "visual", "visual one"]);
  await p.must(["say", "werk-chat", "chat two"]);
  const out = await p.must(["inbox"]);
  const chat = group(out, "werk-chat");
  const vis = group(out, "visual");
  expect(chat.indexOf("chat one")).toBeGreaterThan(-1);
  expect(chat.indexOf("chat two")).toBeGreaterThan(chat.indexOf("chat one"));
  expect(vis).toContain("visual one");
  expect(vis).not.toContain("chat one");
  expect(vis).not.toContain("chat two");
});

test("68.4 an agent writes a note on a ghost card", async () => {
  const p = project();
  decided(p, "visual", { title: "Visual" });
  await p.must(["add", "werk-pane", "--title", "The pane", "--parent", "visual"]);
  await p.must(["link", "visual", "werk-pane", "--type", "supported_by"]).catch(() => undefined);
  const r = await p.werk(["say", "werk-pane", "Describe the pane here"]);
  expect(r.code).toBe(0);
  const g = group(await p.must(["inbox"]), "werk-pane");
  expect(g).toContain("Describe the pane here");
});

test("68.5 a note on an unknown card fails and changes nothing", async () => {
  const p = project();
  decided(p, "werk-chat", { title: "Chat" });
  const file = join(p.dir, ".werk", "log.jsonl");
  const size = statSync(file).size;
  const r = await p.werk(["say", "#no-such-card", "lost note"]);
  expect(r.code).not.toBe(0);
  expect(r.out + r.err).toContain("no-such-card");
  expect(statSync(file).size).toBe(size);
  expect(await p.must(["inbox"])).not.toContain("lost note");
});
