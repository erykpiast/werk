import { expect, test } from "bun:test";
import { removeFactsOf, removeQuestion, sendCardAction } from "./card-actions";

test("the ✕ facts are read from its data attributes", () => {
  expect(
    removeFactsOf({
      cards: "3",
      children: "2",
      parent: "r",
      parentTitle: "Root",
    }),
  ).toEqual({ cards: 3, children: 2, parent: { id: "r", title: "Root" } });
  expect(removeFactsOf({})).toEqual({ cards: 1, children: 0, parent: null });
  expect(removeFactsOf({ parent: "r" }).parent).toEqual({
    id: "r",
    title: "r",
  });
});

test("a card with no children gets one plain question that names the count", () => {
  const q = removeQuestion({ cards: 1, children: 0, parent: null });
  expect(q.text).toBe("Remove this card? 1 card leaves the map.");
  expect(q.choices).toEqual([{ label: "Remove 1 card", reparent: false }]);
});

test("a card with two children offers both answers with their counts", () => {
  const q = removeQuestion({
    cards: 3,
    children: 2,
    parent: { id: "r", title: "Root" },
  });
  expect(q.text).toBe("This card has 2 children. What goes?");
  expect(q.choices.map((c) => c.reparent)).toEqual([false, true]);
  expect(q.choices[0]?.label).toContain("3 cards leave the map");
  expect(q.choices[1]?.label).toContain('2 children move up to "Root"');
});

test("a root with children can only remove the subtree", () => {
  const q = removeQuestion({ cards: 2, children: 1, parent: null });
  expect(q.choices).toHaveLength(1);
  expect(q.choices[0]?.label).toContain("2 cards leave the map");
});

test("an action posts to the project's route with the token", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const reply = (res: Response) => async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return res;
  };
  const ok = await sendCardAction(
    { fetch: reply(Response.json({ ok: true })), token: "tok" },
    "demo",
    "accept",
    { card: "g" },
  );
  expect(ok).toBeNull();
  expect(seen[0]?.url).toBe("/api/projects/demo/accept");
  expect(
    (seen[0]?.init.headers as Record<string, string> | undefined)?.[
      "x-werk-token"
    ],
  ).toBe("tok");
  expect(seen[0]?.init.body).toBe('{"card":"g"}');
});

test("a refusal returns its message, or the status when it has none", async () => {
  const refuse = (res: Response) => ({ fetch: async () => res, token: "t" });
  expect(
    await sendCardAction(
      refuse(Response.json({ message: "no proposal" }, { status: 409 })),
      "demo",
      "remove",
      { card: "c", reparent: true },
    ),
  ).toBe("no proposal");
  expect(
    await sendCardAction(
      refuse(new Response("x", { status: 403 })),
      "demo",
      "accept",
      {
        card: "c",
      },
    ),
  ).toBe("The server refused: 403");
});
