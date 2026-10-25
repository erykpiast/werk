import { expect, test } from "bun:test";
import { renderCard } from "./card-text.ts";
import { fold } from "./fold.ts";

const ev = (event: unknown, line: number) => ({ line, event });
const base = { type: "node.proposed", kind: "card", status: "open" };

test("a ghost under a parent prints as proposed, and its parent lists it", () => {
  const map = fold([
    ev({ ...base, id: "p", title: "Parent" }, 1),
    ev(
      {
        ...base,
        id: "c",
        title: "#Child",
        why: "because",
        body: "details",
        parent: "p",
      },
      2,
    ),
  ]);
  const child = renderCard(map, "c") ?? "";
  expect(child).toContain("card c  [open]  proposed");
  expect(child).toContain("#Child");
  expect(child).toContain("why: because");
  expect(child).toContain("details");
  expect(child).toContain("-> refines");
  expect(renderCard(map, "p")).toContain(
    "<- refines        c  #Child  [proposed]",
  );
});

test("an unknown card has no text", () => {
  expect(renderCard(fold([]), "x")).toBeNull();
});

test("a card with notes prints a thread with each note and the marker", () => {
  const log = [
    ev({ ...base, id: "x", title: "X" }, 1),
    ev(
      { type: "note.added", id: "x", by: "you", text: "Say what it writes." },
      2,
    ),
  ];
  const text = renderCard(fold(log), "x") ?? "";
  expect(text).toContain("thread:");
  expect(text).toContain("Say what it writes.");
});

test("a card with no notes prints no thread section", () => {
  const map = fold([ev({ ...base, id: "x", title: "X" }, 1)]);
  expect(renderCard(map, "x")).not.toContain("thread:");
});
