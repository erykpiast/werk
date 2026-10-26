import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const events = (p: Project) => readFileSync(logOf(p), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
function seed(p: Project, type: string, payload: object) {
  appendFileSync(logOf(p), `${JSON.stringify({ seq: events(p).length + 1, at: "t", actor: "you", type, payload })}\n`);
}
const card = (p: Project, id: string, title: string, decided = false) => {
  seed(p, "node.added", { id, kind: "card", title });
  if (decided) seed(p, "node.decided", { id });
};
const must = async (p: Project, args: string[]) => {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`${args.join(" ")}: ${r.err}`);
  return r;
};
/** Entries of the inbox: header line then text line. */
const groups = (out: string) =>
  [...out.matchAll(/^\[(\d+)\] #(\S+).*\n\s+(.*)$/gm)].map(([, , id, text]) => ({ id: id as string, text: text as string }));

test("68.1 an agent writes a note on a card and sees it on the card", async () => {
  const p = freshProject();
  card(p, "werk-chat", "The composer sends a live agent turn", true);
  const before = events(p).length;
  const r = await p.werk(["say", "#werk-chat", "The reply streams over SSE"]);
  expect(r.code).toBe(0);
  const after = events(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1).type).toBe("note.added");
  expect(after.at(-1).payload.id).toBe("werk-chat");
  const show = await must(p, ["show", "#werk-chat"]);
  expect(show.out).toContain("The reply streams over SSE");
});

test("68.2 an agent reads a whole card thread in order from the inbox", async () => {
  const p = freshProject();
  card(p, "werk-chat", "Chat");
  for (const t of ["first", "second", "third"]) await must(p, ["say", "werk-chat", t]);
  const out = (await must(p, ["inbox"])).out;
  expect(out).toContain("#werk-chat");
  const g = groups(out).filter((e) => e.id === "werk-chat").map((e) => e.text);
  expect(g).toEqual(["first", "second", "third"]);
});

test("68.3 the inbox groups notes by card", async () => {
  const p = freshProject();
  card(p, "werk-chat", "Chat");
  card(p, "visual", "Visual");
  await must(p, ["say", "werk-chat", "chat one"]);
  await must(p, ["say", "visual", "visual one"]);
  await must(p, ["say", "werk-chat", "chat two"]);
  const out = (await must(p, ["inbox"])).out;
  const g = groups(out);
  expect(g.filter((e) => e.id === "werk-chat").map((e) => e.text)).toEqual(["chat one", "chat two"]);
  expect(g.filter((e) => e.id === "visual").map((e) => e.text)).toEqual(["visual one"]);
});

test("68.4 an agent writes a note on a ghost card", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  card(p, "root", "Root");
  card(p, "visual", "Visual");
  await must(p, ["add", "werk-pane", "--title", "The pane shows the chat", "--parent", "root"]);
  await must(p, ["link", "visual", "werk-pane", "--type", "depends_on", "--why", "the visual needs the pane"]);
  const r = await p.werk(["say", "werk-pane", "Describe the pane here"]);
  expect(r.code).toBe(0);
  const out = (await must(p, ["inbox"])).out;
  expect(out).toContain("#werk-pane");
  expect(groups(out).filter((e) => e.id === "werk-pane").map((e) => e.text)).toEqual(["Describe the pane here"]);
});

test("68.5 a note on an unknown card fails and changes nothing", async () => {
  const p = freshProject();
  card(p, "werk-chat", "Chat");
  const size = readFileSync(logOf(p), "utf8").length;
  const r = await p.werk(["say", "#no-such-card", "lost note"]);
  expect(r.code).not.toBe(0);
  expect(r.out + r.err).toContain("no-such-card");
  expect(r.out + r.err).toMatch(/unknown/);
  expect(readFileSync(logOf(p), "utf8").length).toBe(size);
  expect((await must(p, ["inbox"])).out).not.toContain("lost note");
});
