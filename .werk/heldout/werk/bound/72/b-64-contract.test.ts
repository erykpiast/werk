import { expect, test } from "bun:test";
import { decided, type P, project } from "./b-helpers.ts";

const statusOf = async (p: P, id: string) => /\[(\w+)\]/.exec((await p.must(["show", id])).split("\n")[0] ?? "")?.[1];

function fullCard(p: P): void {
  decided(p, "base", { title: "Base card" });
  p.card("subject", { title: "Subject card", body: "A long body that explains the subject in detail.", who: "you" });
  p.seed("edge.added", { from: "subject", to: "base", type: "depends_on", why: "it reuses the base" });
  p.card("subject:opt0", { kind: "option", title: "Another way", why_not: "it costs more" });
  p.seed("edge.added", { from: "subject:opt0", to: "subject", type: "alternative_to" });
}

test("64.1 a card that lacks a kill criterion stays open, and the printed command fixes it", async () => {
  const p = project();
  fullCard(p);
  const before = p.log().length;
  const r = await p.werk(["status", "subject", "decided"]);
  expect(r.code).not.toBe(0);
  const text = r.out + r.err;
  expect(text).toContain("kill criterion");
  expect(text).not.toContain("who:");
  const printed = text
    .split("\n")
    .map((l) => l.trim().replace(/^or: /, ""))
    .find((l) => l === "werk kill subject --revisit");
  expect(printed).toBeDefined();
  expect(await statusOf(p, "subject")).toBe("open");
  expect(p.log().length).toBe(before);
  await p.must((printed as string).split(" ").slice(1));
  const again = await p.werk(["status", "subject", "decided"]);
  expect(again.code).toBe(0);
  expect(await statusOf(p, "subject")).toBe("decided");
});

test("64.2 a card that lacks several facts reports each with its own command", async () => {
  const p = project();
  decided(p, "base", { title: "Base card" });
  p.card("bare", { title: "Bare card", body: "Only words." });
  const r = await p.werk(["status", "bare", "decided"]);
  expect(r.code).not.toBe(0);
  const text = r.out + r.err;
  expect(text).toContain("who:");
  expect(text).toContain("basis:");
  expect(text).toContain("--type depends_on");
  expect(text).toContain("option:");
  expect(text).toContain("kill criterion:");
  expect(text).toContain("werk edit bare --who");
  expect(text).toContain("werk link bare <card> --type depends_on");
  expect(text).toContain("werk add bare:opt0 --kind option");
  expect(text).toContain("werk kill bare");
  expect(await statusOf(p, "bare")).toBe("open");
  // Each printed command, with its placeholders filled in.
  await p.must(["edit", "bare", "--who", "you"]);
  await p.must(["link", "bare", "base", "--type", "depends_on", "--why", "it takes the base log"]);
  await p.must(["add", "bare:opt0", "--kind", "option", "--title", "Another way", "--why_not", "costs more"]);
  await p.must(["link", "bare:opt0", "bare", "--type", "alternative_to"]);
  await p.must(["kill", "bare", "--revisit"]);
  const again = await p.werk(["status", "bare", "decided"]);
  expect(again.code).toBe(0);
  expect(await statusOf(p, "bare")).toBe("decided");
});

test("64.3 a ghost card obeys the same check through its held edges", async () => {
  const p = project();
  decided(p, "base", { title: "Base card" });
  await p.must(["add", "g1", "--title", "First ghost", "--who", "you"]);
  await p.must(["link", "g1", "base", "--type", "depends_on", "--why", "it takes the base"]);
  await p.must(["add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "worse"]);
  await p.must(["link", "g1:opt0", "g1", "--type", "alternative_to"]);
  await p.must(["kill", "g1", "--revisit"]);
  await p.must(["add", "g2", "--title", "Second ghost", "--who", "you"]);
  await p.must(["add", "g2:opt0", "--kind", "option", "--title", "Other", "--why_not", "worse"]);
  await p.must(["link", "g2:opt0", "g2", "--type", "alternative_to"]);
  await p.must(["kill", "g2", "--revisit"]);
  const r1 = await p.werk(["status", "g1", "decided"]);
  expect(r1.code).toBe(0);
  expect(await statusOf(p, "g1")).toBe("decided");
  const r2 = await p.werk(["status", "g2", "decided"]);
  expect(r2.code).not.toBe(0);
  const text = r2.out + r2.err;
  expect(text).toContain("basis");
  expect(text).toContain("werk link g2 <card> --type depends_on");
  expect(await statusOf(p, "g2")).not.toBe("decided");
});

test("64.4 an amend that removes a required fact is refused", async () => {
  const p = project();
  fullCard(p);
  await p.must(["kill", "subject", "--revisit"]);
  await p.must(["status", "subject", "decided"]);
  const shown = await p.must(["show", "subject"]);
  const before = p.log().length;
  const r = await p.werk(["unlink", "subject", "base", "--type", "depends_on"]);
  expect(r.code).not.toBe(0);
  const text = r.out + r.err;
  expect(text).toContain("basis");
  expect(text).toContain("--type depends_on");
  expect(p.log().length).toBe(before);
  expect(await statusOf(p, "subject")).toBe("decided");
  expect(await p.must(["show", "subject"])).toBe(shown);
});

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", async () => {
  const p = project();
  fullCard(p);
  await p.must(["kill", "subject", "--revisit"]);
  await p.must(["status", "subject", "decided"]);
  const before = p.log().length;
  const ops = [{ tag: "elaborated", old: "A long body that explains the subject in detail.", new: "Short." }];
  await p.must(["propose", "subject", "--ops", JSON.stringify(ops)]);
  const r = await p.werk(["accept", "subject", "--actor", "you"]);
  expect(r.code).toBe(0);
  const shown = await p.must(["show", "subject"]);
  expect(shown.split("\n")[0]).toContain("[decided]");
  expect(shown).toContain("Short.");
  expect(shown).not.toContain("A long body");
  const added = p
    .log()
    .slice(before)
    .map((l) => JSON.parse(l) as { type: string; payload: { id: string } });
  const types = added.filter((e) => e.payload.id === "subject").map((e) => e.type);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
});
