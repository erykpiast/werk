import { expect, test } from "bun:test";
import { projectNames } from "./names.ts";

test("a project is named by its folder name", () => {
  expect(projectNames(["/work/checkout", "/home/me/werk"])).toEqual([
    "checkout",
    "werk",
  ]);
});

test("two folders named api get distinct names, and the later one names its parent", () => {
  expect(projectNames(["/home/me/api", "/home/me/work/api"])).toEqual([
    "api",
    "api (work)",
  ]);
});

test("a third clash and a clash on the parent name still give distinct names", () => {
  const names = projectNames([
    "/a/api",
    "/b/work/api",
    "/c/work/api",
    "/d/api",
  ]);
  expect(names[0]).toBe("api");
  expect(names[1]).toBe("api (work)");
  expect(names[2]).toBe("api (/c/work)");
  expect(names[3]).toBe("api (d)");
  expect(new Set(names).size).toBe(4);
});

test("the file system root is named by its path", () => {
  expect(projectNames(["/"])).toEqual(["/"]);
});

test("a folder that repeats an earlier one still gets its own name", () => {
  const names = projectNames(["/a/api", "/a/api"]);
  expect(new Set(names).size).toBe(2);
});
