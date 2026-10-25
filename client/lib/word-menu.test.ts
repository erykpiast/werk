import { expect, test } from "bun:test";
import type { SearchRow } from "./card-search";
import {
  cardMatches,
  commandMatches,
  insertChoice,
  type Word,
  wordAt,
} from "./word-menu";

const row = (id: string, title: string): SearchRow => ({
  id,
  kind: "card",
  title,
  why: "",
  status: "decided",
  stale: false,
  postponed: false,
});

test("a slash or hash at the start of a word opens a menu anywhere in the text", () => {
  expect(wordAt("/re", 3)).toEqual({
    trigger: "/",
    query: "re",
    start: 0,
    end: 3,
  });
  expect(wordAt("hi\nsee #pr", 10)).toEqual({
    trigger: "#",
    query: "pr",
    start: 7,
    end: 10,
  });
  expect(wordAt("a /", 3)?.query).toBe("");
});

test("a backtick before the trigger, or in the word, opens no menu", () => {
  expect(wordAt("`#id", 4)).toBeNull();
  expect(wordAt("`/cmd", 5)).toBeNull();
  expect(wordAt("/re/x", 5)).toBeNull();
  expect(wordAt("#a#b", 4)).toBeNull();
  expect(wordAt("#a`", 3)).toBeNull();
});

test("a trigger inside a word, or a plain word, opens no menu", () => {
  expect(wordAt("a/b", 3)).toBeNull();
  expect(wordAt("hello", 5)).toBeNull();
  expect(wordAt("/re ", 4)).toBeNull();
});

test("commands match by prefix with the case ignored", () => {
  expect(commandMatches(["review", "recall", "compact"], "RE")).toEqual([
    "review",
    "recall",
  ]);
});

test("cards match by id first, then by title", () => {
  const rows = [
    row("werk-pr", "Other"),
    row("x", "Pretty print"),
    row("y", "Nothing"),
  ];
  expect(cardMatches(rows, "pr").map((r) => r.id)).toEqual(["werk-pr", "x"]);
  expect(cardMatches(rows, "")).toEqual([]);
});

test("a choice replaces the word and adds a space", () => {
  const word: Word = { trigger: "#", query: "pr", start: 4, end: 7 };
  expect(insertChoice("see #pr tail", word, "werk-pr")).toEqual({
    text: "see #werk-pr  tail",
    caret: 13,
  });
});
