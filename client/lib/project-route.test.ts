import { expect, test } from "bun:test";
import { apiOf, firstOpenable, pageOf, projectOf } from "./project-route";

test("a page address names its project, also when the name holds a space or a bracket", () => {
  expect(projectOf("/p/werk")).toBe("werk");
  expect(projectOf(pageOf("api (work)"))).toBe("api (work)");
  expect(projectOf("/p/werk/extra")).toBe("werk");
});

test("an address with no project, an empty one or a broken one names none", () => {
  expect(projectOf("/")).toBeNull();
  expect(projectOf("/p/")).toBeNull();
  expect(projectOf("/p/%E0%A4%A")).toBeNull();
  expect(projectOf("/other/werk")).toBeNull();
});

test("an API path of a project carries the encoded name", () => {
  expect(apiOf("api (work)", "/open")).toBe("/api/projects/api%20(work)/open");
});

test("the first project that can open is chosen, and a list of missing ones gives none", () => {
  expect(
    firstOpenable([
      { name: "a", missing: true },
      { name: "b", missing: false },
    ]),
  ).toBe("b");
  expect(firstOpenable([{ name: "a", missing: true }])).toBeNull();
  expect(firstOpenable([])).toBeNull();
});
