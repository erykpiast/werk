import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
import { card, ok, seed } from "./util.ts";

test("63.2 accepting a ghost child takes its ghost parent, not a ghost it depends on", async () => {
  const p = freshProject();
  seed(p, [card("platform", { title: "Platform" })]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform", "--why", "x"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth", "--why", "x"]);
  await ok(p, ["add", "email", "--title", "Email service", "--parent", "platform", "--why", "x"]);
  await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "sends the link by mail"]);
  await ok(p, ["accept", "magic", "--actor", "you"]);
  const magic = (await ok(p, ["show", "magic"])).out;
  expect(magic).toMatch(/^card magic {2}\[open\]/);
  expect(magic).not.toContain("proposed");
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toMatch(/^card auth {2}\[open\]/);
  expect(auth).not.toContain("proposed");
  expect(auth).toContain("parent: platform  Platform");
  expect(auth).toMatch(/-> refines +platform +Platform\n/);
  const email = (await ok(p, ["show", "email"])).out;
  expect(email).toMatch(/^card email {2}\[open\] {2}proposed/);
  expect(magic).toMatch(/-> depends_on +email +Email service +\(ghost, held\)/);
}, 60000);
