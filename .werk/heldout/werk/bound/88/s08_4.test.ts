import { expect, test } from "bun:test";
import { card, lines, link, ok, withMap } from "./h62util.ts";

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = withMap([
    card("root", "Root"),
    card("login", "Login", "root"),
    card("billing", "Billing", "root"),
    ["node.added", { id: "rfc-6749", kind: "source", title: "OAuth RFC" }],
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = (await ok(p, ["show", "rfc-6749"])).out;
  expect(src).toContain("OAuth RFC");
  expect(src).toMatch(/<- supported_by\s+billing/);
  expect(src).not.toContain("login");
  const before = lines(p);
  const add = await p.werk(["add", "login", "--title", "New login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore #login");
  expect(lines(p)).toEqual(before);
  expect((await p.werk(["show", "login"])).code).toBe(1);
  expect((await ok(p, ["show", "root"])).out).not.toContain("New login");
}, 60_000);
