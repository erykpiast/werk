import { expect, test } from "bun:test";
import { parseArgs } from "./args.ts";
import type { Verb } from "./registry.ts";

const link: Verb = {
  name: "link",
  help: "Link two cards.",
  positionals: [
    { name: "from", value: "id" },
    { name: "to", value: "id" },
    { name: "note", value: "text", optional: true },
  ],
  flags: [
    { name: "parent", value: "id", help: "The parent card." },
    { name: "title", value: "text", help: "The title." },
    { name: "why", value: "text", help: "The reason." },
    { name: "force", help: "Skip the check." },
  ],
  run: () => 0,
};

test("positional card ids lose one leading hash", () => {
  expect(parseArgs(link, ["#auth", "##login"])).toEqual({
    ok: true,
    args: { positionals: ["auth", "#login"], flags: {} },
  });
});

test("a flag whose value is a card id loses one leading hash, in both forms", () => {
  expect(parseArgs(link, ["a", "b", "--parent", "#root"])).toMatchObject({ args: { flags: { parent: "root" } } });
  expect(parseArgs(link, ["a", "b", "--parent=#root"])).toMatchObject({ args: { flags: { parent: "root" } } });
});

test("a text flag that starts with a hash passes through unchanged", () => {
  const parsed = parseArgs(link, ["a", "b", "--title", "#auth is the gate", "--why=#auth #login"]);
  expect(parsed).toMatchObject({ args: { flags: { title: "#auth is the gate", why: "#auth #login" } } });
});

test("a text positional keeps its hash", () => {
  expect(parseArgs(link, ["a", "b", "#note"])).toMatchObject({ args: { positionals: ["a", "b", "#note"] } });
});

test("a switch is true when present", () => {
  expect(parseArgs(link, ["a", "b", "--force"])).toMatchObject({ args: { flags: { force: true } } });
});

test("a flag value may start with dashes", () => {
  expect(parseArgs(link, ["a", "b", "--why", "--force"])).toMatchObject({ args: { flags: { why: "--force" } } });
});

test("wrong arguments are refused with the reason", () => {
  expect(parseArgs(link, ["a"])).toEqual({ ok: false, error: "link needs <to>" });
  expect(parseArgs(link, ["a", "b", "c", "d"])).toEqual({ ok: false, error: "link takes no argument d" });
  expect(parseArgs(link, ["a", "b", "--nope"])).toEqual({ ok: false, error: "link has no flag --nope" });
  expect(parseArgs(link, ["a", "b", "--parent"])).toEqual({ ok: false, error: "--parent needs a value" });
  expect(parseArgs(link, ["a", "b", "--force=yes"])).toEqual({ ok: false, error: "--force takes no value" });
});

test("a verb with no positionals or flags takes none", () => {
  const bare: Verb = { name: "bare", help: "Bare.", run: () => 0 };
  expect(parseArgs(bare, [])).toEqual({ ok: true, args: { positionals: [], flags: {} } });
  expect(parseArgs(bare, ["--x"])).toEqual({ ok: false, error: "bare has no flag --x" });
});

test("a one-letter flag is written with one dash", () => {
  const inbox: Verb = {
    name: "inbox",
    help: "Read notes.",
    flags: [
      { name: "n", value: "text", help: "The count." },
      { name: "q", help: "Quiet." },
    ],
    run: () => 0,
  };
  expect(parseArgs(inbox, ["-n", "5", "-q"])).toEqual({
    ok: true,
    args: { positionals: [], flags: { n: "5", q: true } },
  });
  expect(parseArgs(inbox, ["-n"])).toEqual({ ok: false, error: "-n needs a value" });
  expect(parseArgs(inbox, ["-x"])).toEqual({ ok: false, error: "inbox takes no argument -x" });
});
