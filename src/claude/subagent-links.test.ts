import { expect, test } from "bun:test";
import { subagentLinkFailures } from "./subagent-links";

test("links for every shipped subagent pass", () => {
  expect(subagentLinkFailures({ a: "link", b: "link" })).toEqual([]);
});

test("a missing link fails and names the subagent", () => {
  expect(subagentLinkFailures({ a: "missing" })).toEqual([
    "subagent a: no link in the subagent folder",
  ]);
});

test("a copy in place of a link fails", () => {
  expect(subagentLinkFailures({ a: "file" })).toEqual([
    "subagent a: the file in the subagent folder is a copy, not a link",
  ]);
});
