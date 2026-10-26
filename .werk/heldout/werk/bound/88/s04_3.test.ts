import { expect, test } from "bun:test";
import { card, ok, withMap } from "./h62util.ts";

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = withMap([card("root", "Root"), card("onboarding", "Onboarding", "root")]);
  await ok(p, ["add", "email", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "email"]);
  await ok(p, ["discard", "email"]);
  for (const id of ["email", "resend"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).toBe(1);
    expect(`${run.out}${run.err}`).toContain(`no node #${id} in the map`);
  }
  const show = (await ok(p, ["show", "onboarding"])).out;
  expect(show).not.toContain("email");
  expect(show).not.toContain("Email verification");
  expect(show).not.toContain("Resend");
  expect(show).not.toContain("ghost");
  expect(show).not.toContain("refines         email");
}, 30_000);
