import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
import { decided, ok, seed, words } from "./util.ts";

test("64.3 a ghost obeys the contract check through its held edges", async () => {
  const p = freshProject();
  seed(p, decided("base"));
  for (const id of ["g1", "g2"]) {
    await ok(p, ["add", id, "--title", `Ghost ${id}`, "--why", "x"]);
    await ok(p, ["edit", id, "--who", "you"]);
    await ok(p, ["add", `${id}:opt0`, "--kind", "option", "--title", "Other", "--why_not", "Worse"]);
    await ok(p, ["link", `${id}:opt0`, id, "--type", "alternative_to"]);
    await ok(p, ["kill", id, "--revisit"]);
  }
  await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "g1 uses base"]);
  const first = await p.werk(["status", "g1", "decided"]);
  expect(first.code).toBe(0);
  expect((await ok(p, ["show", "g1"])).out).toMatch(/^card g1 {2}\[decided\] {2}proposed/);
  const second = await p.werk(["status", "g2", "decided"]);
  expect(second.code).not.toBe(0);
  expect(second.err).toContain("basis: no decided card is a basis of #g2");
  expect(second.err).toContain('werk link g2 <card> --type depends_on --why');
  expect((await ok(p, ["show", "g2"])).out).toMatch(/^card g2 {2}\[open\] {2}proposed/);
  expect(words('x').length).toBe(1);
}, 60000);
