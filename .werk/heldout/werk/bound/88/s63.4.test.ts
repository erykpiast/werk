import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
import { card, ok, seed } from "./util.ts";

test("63.4 discarding a ghost parent discards its whole ghost branch", async () => {
  const p = freshProject();
  seed(p, [card("platform", { title: "Platform" })]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform", "--why", "x"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth", "--why", "x"]);
  await ok(p, ["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "weak"]);
  await ok(p, ["link", "magic:opt0", "magic", "--type", "alternative_to"]);
  await ok(p, ["discard", "auth"]);
  for (const id of ["auth", "magic", "magic:opt0"]) expect((await p.werk(["show", id])).code).not.toBe(0);
  const platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).toMatch(/^card platform {2}\[open\]\n/);
  for (const w of ["auth", "Auth", "magic", "Magic", "Passwords", "ghost"]) expect(platform).not.toContain(w);
  const find = (await ok(p, ["find"])).out;
  for (const w of ["auth", "magic", "Passwords"]) expect(find).not.toContain(w);
}, 60000);
