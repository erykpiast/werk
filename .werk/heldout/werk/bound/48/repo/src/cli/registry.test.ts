import { expect, test } from "bun:test";
import { Registry, registerVerb, registry, type Verb } from "./registry.ts";

const verb = (name: string): Verb => ({ name, help: `The ${name} verb.`, run: () => 0 });

test("a registered verb is found by its name", () => {
  const verbs = new Registry();
  const show = verb("show");
  verbs.register(show);
  expect(verbs.get("show")).toBe(show);
  expect(verbs.get("hide")).toBeUndefined();
});

test("the list holds every registered verb, ordered by name", () => {
  const verbs = new Registry();
  verbs.register(verb("show"));
  verbs.register(verb("add"));
  expect(verbs.list().map((v) => v.name)).toEqual(["add", "show"]);
});

test("a second verb with the same name is refused", () => {
  const verbs = new Registry();
  verbs.register(verb("show"));
  expect(() => verbs.register(verb("show"))).toThrow("the verb show is registered twice");
});

test("registerVerb adds to the registry of the command line", () => {
  registerVerb(verb("registry-test-verb"));
  expect(registry.get("registry-test-verb")?.name).toBe("registry-test-verb");
});
