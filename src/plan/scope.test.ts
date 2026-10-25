import { expect, test } from "bun:test";
import { fold } from "../map/fold.ts";
import { decided, link, open, reopen } from "../map/mark-fixtures.ts";
import { lastChanges, planScope, refsIn } from "./scope.ts";

const under = (id: string, parent: string, extra = {}) =>
  decided(id, { parent, ...extra });

const mapOf = (events: unknown[]) =>
  fold(events.map((event, i) => ({ line: i + 1, event })));

/** The example of the scope rule: #app, #app-login, #mail with two children, #queue, #infra and #cdn. */
const example = () => [
  ...decided("infra"),
  ...under("cdn", "infra"),
  ...under("mail", "infra"),
  ...under("mail-retry", "mail"),
  ...open("mail-bounce", { parent: "mail" }),
  ...decided("queue"),
  ...decided("app"),
  ...under("app-login", "app"),
  link("app-login", "mail"),
  link("mail-retry", "queue"),
];

test("the scope follows depends_on down in two tiers and never up", () => {
  const scope = planScope(mapOf(example()), "app");
  expect(scope.first).toEqual(["app", "app-login", "mail"]);
  expect(scope.second).toEqual(["mail-retry", "queue"]);
  expect(scope.stops).toEqual([]);
});

test("an open card in the first tier stops the plan, and one in the second tier does not", () => {
  const events = example();
  expect(planScope(mapOf(events), "app").stops).toEqual([]);
  const scope = planScope(
    mapOf([...events, ...open("late", { parent: "app" })]),
    "app",
  );
  expect(scope.stops).toEqual([{ id: "late", reason: "open" }]);
});

test("an open card that a subtree card links stops the plan", () => {
  const scope = planScope(
    mapOf([...decided("app"), ...open("draft"), link("app", "draft")]),
    "app",
  );
  expect(scope.stops).toEqual([{ id: "draft", reason: "open" }]);
});

test("a postponed card stays out without a stop, and nothing below it comes in", () => {
  const scope = planScope(
    mapOf([
      ...decided("app"),
      ...under("later", "app"),
      ...under("later-child", "later"),
      reopen("later", { reason: "postponed" }),
    ]),
    "app",
  );
  expect(scope.first).toEqual(["app"]);
  expect(scope.stops).toEqual([]);
});

test("a card text names a card with a hash sign, and a reference to a parent is not followed", () => {
  const scope = planScope(
    mapOf([
      ...decided("top"),
      ...decided("app", { parent: "top", body: "Builds on #mail, see #top." }),
      ...decided("mail"),
    ]),
    "app",
  );
  expect(scope.first).toEqual(["app", "mail"]);
});

test("a ghost is never in the scope", () => {
  const ghosts = [
    ...decided("app"),
    {
      type: "node.proposed",
      id: "app-new",
      kind: "card",
      title: "New",
      status: "open",
      parent: "app",
    },
  ];
  const scope = planScope(mapOf(ghosts), "app");
  expect(scope).toEqual({ first: ["app"], second: [], stops: [] });
});

test("a marked root leaves a stop, so a plan never runs on nothing", () => {
  const scope = planScope(
    mapOf([...decided("app"), reopen("app", { reason: "postponed" })]),
    "app",
  );
  expect(scope.first).toEqual([]);
  expect(scope.stops.map((s) => s.id)).toEqual(["app"]);
});

test("refsIn drops trailing punctuation until the token is a known id", () => {
  const known = new Set(["a-b", "c"]);
  expect(refsIn("see #a-b. And (#c), not #zz or x#c", known)).toEqual([
    "a-b",
    "c",
  ]);
});

test("lastChanges holds the line of the last event that names each card", () => {
  const entries = [
    { line: 1, event: { type: "node.proposed", id: "a" } },
    { line: 2, event: { type: "edge.added", from: "b", to: "a" } },
    { line: 3, event: "not an object" },
    { line: 5, event: { type: "node.edited", id: "a" } },
  ];
  expect(lastChanges(entries, ["a", "b", "z"])).toEqual({ a: 5, b: 2 });
});
