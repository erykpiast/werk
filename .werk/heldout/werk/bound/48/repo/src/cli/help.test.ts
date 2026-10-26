import { expect, test } from "bun:test";
import { formatHelp, formatVerb } from "./help.ts";
import type { Verb } from "./registry.ts";

const add: Verb = {
  name: "add",
  help: "Propose a card.",
  positionals: [
    { name: "id", value: "id" },
    { name: "note", value: "text", optional: true },
  ],
  flags: [
    { name: "parent", value: "id", help: "The parent card." },
    { name: "dry", help: "Print, do not write." },
  ],
  run: () => 0,
};
const version: Verb = { name: "version", help: "Print the version.", run: () => 0 };

test("a verb prints its arguments, its help and each flag with its value kind", () => {
  expect(formatVerb(add)).toBe(
    [
      "  add <id> [<note>]",
      "      Propose a card.",
      "      --parent <id>  The parent card.",
      "      --dry          Print, do not write.",
    ].join("\n"),
  );
});

test("a verb with no flags prints its name and its help", () => {
  expect(formatVerb(version)).toBe("  version\n      Print the version.");
});

test("the help lists every verb it is given", () => {
  const help = formatHelp([add, version]);
  expect(help).toStartWith("Usage: werk <verb>");
  expect(help).toContain("  add <id> [<note>]");
  expect(help).toContain("  version\n");
});

test("a one-letter flag prints with one dash", () => {
  const inbox: Verb = {
    name: "inbox",
    help: "Read.",
    flags: [{ name: "n", value: "text", help: "The count." }],
    run: () => 0,
  };
  expect(formatVerb(inbox)).toBe("  inbox\n      Read.\n      -n <text>  The count.");
});
