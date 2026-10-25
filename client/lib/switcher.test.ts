import { expect, test } from "bun:test";
import { pickOf, rowsOf, type SwitcherProject, stopQuestion } from "./switcher";

const project = (extra: Partial<SwitcherProject>): SwitcherProject => ({
  name: "checkout",
  folder: "/home/me/Projects/checkout",
  missing: false,
  dev: false,
  running: [],
  ...extra,
});

test("a row shows the folder with the home folder as ~, a busy dot for a running turn, and no × for the dev entry", () => {
  const rows = rowsOf(
    [
      project({
        name: "werk",
        folder: "/home/me/werk",
        dev: true,
        running: ["main"],
      }),
      project({}),
      project({ name: "api", folder: "/srv/api", missing: true }),
    ],
    "/home/me",
  );
  expect(rows).toEqual([
    {
      name: "werk",
      folder: "~/werk",
      busy: true,
      missing: false,
      removable: false,
    },
    {
      name: "checkout",
      folder: "~/Projects/checkout",
      busy: false,
      missing: false,
      removable: true,
    },
    {
      name: "api",
      folder: "/srv/api",
      busy: false,
      missing: true,
      removable: true,
    },
  ]);
});

test("a folder that only starts with the home name is not abbreviated", () => {
  expect(
    rowsOf([project({ folder: "/home/meow/x" })], "/home/me")[0]?.folder,
  ).toBe("/home/meow/x");
});

test("a click opens another project, keeps the open one, and refuses a missing folder", () => {
  expect(pickOf({ name: "checkout", missing: false }, "werk")).toBe("open");
  expect(pickOf({ name: "werk", missing: false }, "werk")).toBe("stay");
  expect(pickOf({ name: "api", missing: true }, "werk")).toBe("refuse");
});

test("the stop question names the running turns", () => {
  expect(stopQuestion("werk", ["main", "t2"])).toContain("main, t2");
});
