import { expect, test } from "bun:test";
import { cardId } from "./card-id.ts";

test("an id with one leading hash and an id without one name the same card", () => {
  expect(cardId("#auth")).toBe("auth");
  expect(cardId("auth")).toBe("auth");
});

test("only one leading hash goes", () => {
  expect(cardId("##auth")).toBe("#auth");
});

test("a hash inside the id stays", () => {
  expect(cardId("a#uth")).toBe("a#uth");
  expect(cardId("")).toBe("");
});
