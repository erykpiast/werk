import { expect, test } from "bun:test";
import { card, edge, ghost, setupWerk } from "./support.ts";

const { werk, seed, logLines } = setupWerk();

test("06.1 an excerpt added for a card stages as a ghost with a pending link", async () => {
  seed(card("claim", { title: "The claim", status: "decided", why: "w" }));
  const before = (await werk("show", "claim")).stdout;
  const added = await werk(
    "add",
    "quote1",
    "--kind",
    "excerpt",
    "--title",
    "Ana said it",
    "--body",
    "the exact words",
  );
  expect(added.stderr).toBe("");
  expect(added.code).toBe(0);
  expect(added.stdout.trim()).toBe("proposed");
  const linked = await werk(
    "link",
    "claim",
    "quote1",
    "--type",
    "supported_by",
  );
  expect(linked.code).toBe(0);
  const shownEx = await werk("show", "quote1");
  expect(shownEx.stdout).toContain("proposed");
  const shownCard = await werk("show", "claim");
  expect(shownCard.stdout).toContain("[held]");
  expect(shownCard.stdout).toContain("[decided]");
  expect(shownCard.stdout.split("\n").slice(0, 3)).toEqual(
    before.split("\n").slice(0, 3),
  );
});

test("06.1b (supporting) a seeded excerpt ghost and held link read as ghost and held", async () => {
  seed(
    card("claim", { title: "The claim", status: "decided" }),
    ghost("quote1", { kind: "excerpt", title: "Ana said it" }),
    edge("claim", "quote1", "supported_by"),
  );
  const shownCard = (await werk("show", "claim")).stdout;
  expect(shownCard).toContain("quote1");
  expect(shownCard).toContain("[held]");
  expect(shownCard).toContain("[proposed]");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  seed(
    card("claim", { title: "The claim", status: "decided" }),
    ghost("quote1", { kind: "excerpt", title: "Ana said it" }),
    edge("claim", "quote1", "supported_by"),
  );
  const accepted = await werk("accept", "quote1", "--actor", "you");
  expect(accepted.code).toBe(0);
  const ex = (await werk("show", "quote1")).stdout;
  expect(ex).not.toContain("proposed");
  const c = (await werk("show", "claim")).stdout;
  expect(c).toContain("quote1");
  expect(c).toContain("supported_by");
  expect(c).not.toContain("[held]");
  expect(c).not.toContain("[proposed]");
  expect(logLines().filter((l) => l.includes("node.accepted"))).toHaveLength(2);
});
