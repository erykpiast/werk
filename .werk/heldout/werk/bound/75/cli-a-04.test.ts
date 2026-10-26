// Held-out steps 04.1-04.5: ghosts and accept, through the command line and the log file.
import { expect, test } from "bun:test";
import { card, events, header, isGhost, lines, ok, show, withMap } from "./cli-a-lib.ts";

test("04.1 An agent's new card waits as a ghost until the person accepts it", async () => {
  const project = withMap([card("root", "Root"), card("checkout", "Checkout flow", "root")]);
  // Another ghost in the map, to check that the accept leaves it alone.
  await ok(project, ["add", "other", "--title", "Other ghost", "--parent", "root"]);
  const before = lines(project);
  const add = await ok(project, ["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = lines(project);
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const proposed = JSON.parse(after.at(-1) as string);
  expect(proposed.type).toBe("node.proposed");
  expect(proposed.payload).toMatchObject({ id: "retry", parent: "checkout" });
  const ghost = await ok(project, ["show", "retry"]);
  expect(isGhost(ghost.out)).toBe(true);
  expect(ghost.out).toContain("parent: checkout  Checkout flow");

  const count = lines(project).length;
  await ok(project, ["accept", "retry", "--actor", "you"]);
  const accepted = events(project);
  expect(accepted).toHaveLength(count + 1);
  expect(accepted.at(-1)).toMatchObject({ type: "change.accepted", payload: { id: "retry" } });
  const real = await ok(project, ["show", "retry"]);
  expect(isGhost(real.out)).toBe(false);
  expect(real.out).toContain("parent: checkout  Checkout flow");
  expect(isGhost((await ok(project, ["show", "other"])).out)).toBe(true);
}, 60_000);

test("04.2 Accepting a ghost child also accepts its ghost parent, and its held link goes live with no further event", async () => {
  const project = withMap([
    card("root", "Root"),
    card("payments", "Payments", "root"),
    card("fraud", "Fraud rules", "root"),
  ]);
  await ok(project, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(project, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(project, ["link", "partial", "fraud", "--type", "depends_on", "--why", "A partial refund passes the fraud rules"]);
  await ok(project, ["add", "partial:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "Too strict"]);
  await ok(project, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(project, ["add", "refund-study", "--kind", "source", "--title", "Refund study", "--finding", "Half ask for part"]);
  await ok(project, ["link", "partial", "refund-study", "--type", "supported_by"]);
  const held = (await ok(project, ["show", "partial"])).out;
  const dependsLine = (out: string) => out.split("\n").find((line) => /-> depends_on\s+fraud/.test(line)) ?? "";
  expect(dependsLine(held)).toContain("held");

  const count = lines(project).length;
  await ok(project, ["accept", "partial", "--actor", "you"]);
  const added = events(project).slice(count);
  expect(added.length).toBeGreaterThan(0);
  for (const event of added) expect(event.type).toBe("change.accepted");
  expect(isGhost((await ok(project, ["show", "refunds"])).out)).toBe(false);
  const live = (await ok(project, ["show", "partial"])).out;
  expect(isGhost(live)).toBe(false);
  expect(isGhost((await ok(project, ["show", "partial:opt0"])).out)).toBe(false);
  expect(isGhost((await ok(project, ["show", "refund-study"])).out)).toBe(false);
  expect(dependsLine(live)).not.toBe("");
  expect(dependsLine(live)).not.toContain("held");
}, 60_000);

test("04.3 Discarding a ghost parent drops its ghost children", async () => {
  const project = withMap([card("root", "Root"), card("onboarding", "Onboarding", "root")]);
  await ok(project, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(project, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(project, ["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const run = await show(project, id);
    expect(run.code).not.toBe(0);
    expect(run.err).toContain("no node");
  }
  const onboarding = (await ok(project, ["show", "onboarding"])).out;
  expect(onboarding).not.toContain("ghost");
  expect(onboarding).not.toContain("<- refines");
}, 60_000);

test("04.4 The words of a ghost are frozen", async () => {
  const project = withMap([card("root", "Root"), card("search", "Search", "root")]);
  await ok(project, [
    "add", "search-index", "--title", "Search uses one index", "--why", "One index is simple", "--parent", "search",
  ]);
  const before = lines(project);
  const again = await project.werk([
    "add", "search-index", "--title", "Search uses two indexes", "--why", "Two indexes are fast", "--parent", "search",
  ]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(lines(project)).toEqual(before);
  const out = (await ok(project, ["show", "search-index"])).out;
  expect(out).toContain("Search uses one index");
  expect(out).toContain("why: One index is simple");
  expect(out).not.toContain("two indexes");
}, 60_000);

test("04.5 An accept from the command line needs the statement that the person asked for it", async () => {
  const project = withMap([card("root", "Root"), card("security", "Security", "root")]);
  await ok(project, ["add", "audit-log", "--title", "Audit log", "--parent", "security"]);
  const before = lines(project);
  const refused = await project.werk(["accept", "audit-log"]);
  expect(refused.code).not.toBe(0);
  expect(lines(project)).toEqual(before);
  expect(isGhost((await ok(project, ["show", "audit-log"])).out)).toBe(true);
  const accepted = await project.werk(["accept", "audit-log", "--actor", "you"]);
  expect(accepted.code).toBe(0);
  const out = (await ok(project, ["show", "audit-log"])).out;
  expect(isGhost(out)).toBe(false);
  expect(header(out)).toStartWith("card audit-log");
}, 60_000);
