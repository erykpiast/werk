import { expect, test } from "bun:test";
import { card, held } from "./helpers.ts";

const ghostHeader = (out: string) => (out.split("\n")[0] ?? "").includes("proposed");

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const h = held();
  card(h, "checkout-flow", "Checkout flow");
  // Another ghost elsewhere, for "every other ghost in the map is still a ghost".
  h.seed("node.proposed", { id: "other-ghost", kind: "card", title: "Other ghost" }, "agent");
  const before = h.events().length;

  const add = await h.w("add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow");
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");

  const after = h.events();
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)?.type).toBe("node.proposed");
  expect(after.at(-1)?.payload.parent).toBe("checkout-flow");

  const show = await h.w("show", "retry-payment");
  expect(ghostHeader(show.out)).toBe(true);
  expect(show.out).toContain("parent: checkout-flow  Checkout flow");

  const accept = await h.w("accept", "retry-payment", "--actor", "you");
  expect(accept.code).toBe(0);
  const afterAccept = h.events();
  expect(afterAccept.length).toBe(after.length + 1);
  expect(afterAccept.at(-1)?.type).toBe("change.accepted");

  const shown = await h.w("show", "retry-payment");
  expect(ghostHeader(shown.out)).toBe(false);
  expect(shown.out).toContain("parent: checkout-flow  Checkout flow");
  expect(shown.out).not.toContain("held");

  const other = await h.w("show", "other-ghost");
  expect(ghostHeader(other.out)).toBe(true);
});

test("04.2 accepting a ghost child also accepts its ghost parent; its held link goes live with no further event", async () => {
  const h = held();
  card(h, "payments", "Payments");
  card(h, "fraud-rules", "Fraud rules");
  expect((await h.w("add", "refunds", "--title", "Refunds", "--parent", "payments")).code).toBe(0);
  expect((await h.w("add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds")).code).toBe(0);
  expect(
    (
      await h.w(
        "link",
        "partial-refunds",
        "fraud-rules",
        "--type",
        "depends_on",
        "--why",
        "a partial refund runs the fraud rules first",
      )
    ).code,
  ).toBe(0);
  expect(
    (
      await h.w(
        "add",
        "partial-refunds:opt0",
        "--kind",
        "option",
        "--title",
        "Full refunds only",
        "--why_not",
        "too coarse",
      )
    ).code,
  ).toBe(0);
  expect((await h.w("link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to")).code).toBe(0);
  expect(
    (
      await h.w(
        "add",
        "src-refund-law",
        "--kind",
        "source",
        "--title",
        "Refund law",
        "--url",
        "https://example.invalid/law",
        "--finding",
        "partial refunds are allowed",
      )
    ).code,
  ).toBe(0);
  expect((await h.w("link", "partial-refunds", "src-refund-law", "--type", "supported_by")).code).toBe(0);

  const before = await h.w("show", "partial-refunds");
  const dep = before.out.split("\n").find((line) => line.includes("depends_on") && line.includes("fraud-rules"));
  expect(dep).toBeDefined();
  expect(dep).toContain("held");

  const seqBefore = h.events().length;
  const accept = await h.w("accept", "partial-refunds", "--actor", "you");
  expect(accept.code).toBe(0);
  const fresh = h.events().slice(seqBefore);
  expect(fresh.length).toBeGreaterThan(0);
  expect(fresh.every((event) => event.type === "change.accepted")).toBe(true);

  expect(ghostHeader((await h.w("show", "refunds")).out)).toBe(false);
  const after = await h.w("show", "partial-refunds");
  expect(ghostHeader(after.out)).toBe(false);
  expect(ghostHeader((await h.w("show", "partial-refunds:opt0")).out)).toBe(false);
  expect(ghostHeader((await h.w("show", "src-refund-law")).out)).toBe(false);
  const live = after.out.split("\n").find((line) => line.includes("depends_on") && line.includes("fraud-rules"));
  expect(live).toBeDefined();
  expect(live).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const h = held();
  card(h, "onboarding", "Onboarding");
  expect((await h.w("add", "email-verification", "--title", "Email verification", "--parent", "onboarding")).code).toBe(
    0,
  );
  expect((await h.w("add", "resend-email", "--title", "Resend email", "--parent", "email-verification")).code).toBe(0);
  expect((await h.w("discard", "email-verification")).code).toBe(0);

  for (const id of ["email-verification", "resend-email"]) {
    const show = await h.w("show", id);
    expect(show.code).not.toBe(0);
    expect(show.err).toContain("no node");
  }
  const onboarding = await h.w("show", "onboarding");
  expect(onboarding.out).not.toContain("ghost");
  expect(onboarding.out).not.toContain("<- refines");
});

test("04.4 the words of a ghost are frozen", async () => {
  const h = held();
  card(h, "search", "Search");
  expect(
    (
      await h.w(
        "add",
        "search-index",
        "--title",
        "Search uses one index",
        "--why",
        "one index is cheap",
        "--parent",
        "search",
      )
    ).code,
  ).toBe(0);
  const before = h.events().length;
  const again = await h.w("add", "search-index", "--title", "Search uses two indexes", "--why", "two are fast");
  expect(again.code).not.toBe(0);
  expect(`${again.out}${again.err}`).toContain("a ghost's words are frozen");
  expect(h.events().length).toBe(before);
  const show = await h.w("show", "search-index");
  expect(show.out).toContain("Search uses one index");
  expect(show.out).toContain("one index is cheap");
  expect(show.out).not.toContain("two");
});

test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const h = held();
  card(h, "compliance", "Compliance");
  expect((await h.w("add", "audit-log", "--title", "Audit log", "--parent", "compliance")).code).toBe(0);
  const before = h.events().length;
  const refused = await h.w("accept", "audit-log");
  expect(refused.code).not.toBe(0);
  expect(h.events().length).toBe(before);
  expect(ghostHeader((await h.w("show", "audit-log")).out)).toBe(true);

  const accept = await h.w("accept", "audit-log", "--actor", "you");
  expect(accept.code).toBe(0);
  expect(ghostHeader((await h.w("show", "audit-log")).out)).toBe(false);
});
