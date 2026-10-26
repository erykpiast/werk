import { expect, test } from "bun:test";
import { chat, mk, said } from "./lib.ts";

test("11.1 rollup counts card and whole refines subtree", async () => {
  const h = mk(false);
  h.seed("node.added", { id: "r", kind: "card", title: "R", status: "decided" });
  h.seed("node.added", { id: "c1", kind: "card", title: "C1", parent: "r" });
  h.seed("node.added", { id: "c2", kind: "card", title: "C2", parent: "r", status: "proto" });
  h.seed("node.added", { id: "g", kind: "card", title: "G", parent: "c1", status: "decided" });
  const out = await h.ok("show", "r");
  console.log(out);
  const m = out.split("\n").filter((l) => /subtree:/.test(l));
  expect(m.length).toBe(1);
  expect(m[0]).toContain("4 cards");
  expect(m[0]).toContain("1 open");
  expect(m[0]).toContain("1 proto");
  expect(m[0]).toContain("2 decided");
});

test("11.2 incoming refines link shows child's own rollup", async () => {
  const h = mk(false);
  h.seed("node.added", { id: "p", kind: "card", title: "P" });
  h.seed("node.added", { id: "c", kind: "card", title: "C", parent: "p" });
  h.seed("node.added", { id: "g1", kind: "card", title: "G1", parent: "c" });
  h.seed("node.added", { id: "g2", kind: "card", title: "G2", parent: "c", status: "decided" });
  const out = await h.ok("show", "p");
  console.log(out);
  expect(out).toMatch(/<- refines\s+c\s+C\s+\(3 cards/);
  expect(out).toContain("subtree: 4 cards");
});

test("11.3 card prints options, excerpts, sources with words", async () => {
  const h = mk();
  h.card("base", { title: "Base", status: "decided" });
  h.card("main", { title: "Main" });
  h.seed("edge.added", { from: "main", to: "base", type: "depends_on", why: "takes the log format" });
  h.seed("node.added", { id: "main:opt0", kind: "option", title: "Use a db", why_not: "too heavy to ship" });
  h.seed("edge.added", { from: "main:opt0", to: "main", type: "alternative_to" });
  chat(h, "c", [said("person", "we keep one log per conversation")]);
  await h.ok("quote", "main", "c", "we keep one log per conversation");
  h.seed("node.proposed", { id: "main:src", kind: "source", title: "RFC notes", finding: "retries are safe", parent: undefined }, "agent");
  await h.ok("link", "main", "main:src", "--type", "supported_by");
  const out = await h.ok("show", "main");
  console.log(out);
  expect(out).toContain("takes the log format");
  const iOpt = out.indexOf("Options");
  expect(iOpt).toBeGreaterThan(out.indexOf("depends_on"));
  expect(out).toContain("Use a db");
  expect(out).toContain("too heavy to ship");
  expect(out).toContain("Say");
  expect(out).toContain("person");
  expect(out).toContain("we keep one log per conversation");
  expect(out).toContain("Ev");
  expect(out).toContain("RFC notes");
  expect(out).toContain("retries are safe");
  const evLine = out.split("\n").find((l) => l.includes("RFC notes")) ?? "";
  expect(evLine + out).toContain("proposed");
});

test("11.4 no Options section when no options", async () => {
  const h = mk();
  h.card("main", { title: "Main" });
  chat(h, "c", [said("person", "words said")]);
  await h.ok("quote", "main", "c", "words said");
  h.seed("node.added", { id: "main:src", kind: "source", title: "RFC notes", finding: "f" });
  h.seed("edge.added", { from: "main", to: "main:src", type: "supported_by" });
  const out = await h.ok("show", "main");
  console.log(out);
  expect(out).toContain("Say");
  expect(out).toContain("Ev");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints root card", async () => {
  const h = mk(false);
  h.seed("node.added", { id: "root", kind: "card", title: "Top Title" });
  h.seed("node.added", { id: "kid", kind: "card", title: "Kid", parent: "root" });
  const out = await h.ok("show");
  expect(out).toContain("Top Title");
  expect(out).toContain("subtree: 2 cards");
  expect(out).toMatch(/<- refines\s+kid\s+Kid\s+\(1 card/);
});
