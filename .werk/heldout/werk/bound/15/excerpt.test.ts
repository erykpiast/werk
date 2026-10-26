// Steps 06.1 and 06.2: an excerpt stages as a ghost and goes live with the person's accept.
import { describe, expect, test } from "bun:test";
import { addCard, decidedCard, ok, useWerk } from "./support.ts";

const { project, werk, map } = useWerk();

describe("excerpts", () => {
  test("06.1 a new excerpt for a card stages as a ghost and waits for the accept", async () => {
    await decidedCard(werk, "card");
    const added = await werk("add", "ex1", "--kind", "excerpt", "--title", "what was said");
    expect(added.code).toBe(0);
    expect(added.stdout.trim()).toBe("proposed");
    const link = await werk("link", "card", "ex1", "--type", "supported_by");
    expect(link.code).toBe(0);
    expect(map().nodes.get("ex1")?.proposed).toBe(true);
    const held = map().ghostEdges.find((e) => e.from === "card" && e.to === "ex1");
    expect(held).toBeDefined();
    expect(map().edges.some((e) => e.to === "ex1")).toBe(false);
    expect(map().nodes.get("card")?.status).toBe("decided");
    expect(project().events().length).toBeGreaterThan(0);
  });

  test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
    await addCard(werk, "card");
    await ok(werk, "add", "ex1", "--kind", "excerpt", "--title", "what was said");
    await ok(werk, "link", "card", "ex1", "--type", "supported_by");
    expect((await werk("accept", "ex1", "--actor", "you")).code).toBe(0);
    expect(map().nodes.get("ex1")?.proposed).toBe(false);
    expect(map().edges.some((e) => e.from === "card" && e.to === "ex1" && e.type === "supported_by")).toBe(true);
    expect((await werk("show", "card")).stdout).toContain("ex1");
  });
});
