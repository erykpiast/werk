import { expect, test } from "bun:test";
import { LINK_TYPES, NODE_KINDS, STATUSES, WHOS } from "./types.ts";

test("the map has four node kinds and four link types (#map-card, #vi-edges)", () => {
  expect(NODE_KINDS).toEqual(["card", "option", "source", "excerpt"]);
  expect(LINK_TYPES).toEqual(["refines", "depends_on", "supported_by", "alternative_to"]);
});

test("a card's status and who take the values a card can hold", () => {
  expect(STATUSES).toEqual(["open", "proto", "decided"]);
  expect(WHOS).toEqual(["you", "me", "prototype"]);
});
