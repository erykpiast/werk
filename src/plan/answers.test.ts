import { expect, test } from "bun:test";
import { answerId, parseAnswers, proposalEvent } from "./answers.ts";

const record = (extra: object = {}) => ({
  slug: "one",
  title: "T",
  why: "W",
  body: "B",
  ...extra,
});

test("an empty list is no answers, and a record list is read in order", () => {
  expect(parseAnswers("[]")).toEqual({ ok: true, answers: [] });
  const parsed = parseAnswers(
    JSON.stringify([record(), record({ slug: "two" })]),
  );
  expect(parsed.ok && parsed.answers.map((a) => a.slug)).toEqual([
    "one",
    "two",
  ]);
});

test("a file that is not a list of complete records is refused with the place", () => {
  const error = (text: string) => {
    const parsed = parseAnswers(text);
    return parsed.ok ? "" : parsed.error;
  };
  expect(error("{")).toContain("not JSON");
  expect(error("{}")).toContain("a JSON list");
  expect(error("[1]")).toContain("answer 1 is not an object");
  expect(error(JSON.stringify([record({ why: "" })]))).toContain(
    "needs a text why",
  );
  expect(error(JSON.stringify([record({ slug: "Bad Slug" })]))).toContain(
    "slug",
  );
  expect(error(JSON.stringify([record(), record()]))).toContain("twice");
});

test("an answer is proposed as an open ghost under the root, decided by the agent", () => {
  const answer = { slug: "one", title: "T", why: "W", body: "B" };
  expect(answerId("app", answer)).toBe("app-one");
  expect(proposalEvent("app", answer)).toEqual({
    type: "node.proposed",
    id: "app-one",
    kind: "card",
    title: "T",
    why: "W",
    body: "B",
    status: "open",
    who: "me",
    parent: "app",
  });
});
