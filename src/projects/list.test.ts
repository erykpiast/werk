import { expect, test } from "bun:test";
import {
  listProjects,
  parseFolders,
  serializeFolders,
  withFolder,
  withoutFolder,
} from "./list.ts";

test("a stored list reads back as written", () => {
  const text = serializeFolders(["/a/one", "/b/two"]);
  expect(parseFolders(text)).toEqual({
    ok: true,
    folders: ["/a/one", "/b/two"],
  });
});

test("no stored text is an empty list", () => {
  expect(parseFolders("")).toEqual({ ok: true, folders: [] });
  expect(parseFolders("  \n")).toEqual({ ok: true, folders: [] });
});

test("text that is not a list of folders is refused, never read as empty", () => {
  expect(parseFolders("{oops").ok).toBe(false);
  expect(parseFolders("null").ok).toBe(false);
  expect(parseFolders('{"folders":"x"}').ok).toBe(false);
  expect(parseFolders('{"folders":[1]}').ok).toBe(false);
  expect(parseFolders('{"folders":[""]}').ok).toBe(false);
});

test("a repeated folder in the stored text counts once", () => {
  expect(parseFolders('{"folders":["/a","/a"]}')).toEqual({
    ok: true,
    folders: ["/a"],
  });
});

test("adding a folder twice keeps one entry, and removing a folder keeps the others", () => {
  expect(withFolder(["/a"], "/b")).toEqual(["/a", "/b"]);
  expect(withFolder(["/a"], "/a")).toEqual(["/a"]);
  expect(withoutFolder(["/a", "/b"], "/a")).toEqual(["/b"]);
  expect(withoutFolder(["/a"], "/z")).toEqual(["/a"]);
});

test("the dev entry comes first, is marked, and is not repeated from the stored list", () => {
  expect(listProjects(["/x/api", "/w/werk"], "/w/werk")).toEqual([
    { name: "werk", folder: "/w/werk", dev: true },
    { name: "api", folder: "/x/api", dev: false },
  ]);
});

test("without a dev entry, the list is the stored folders with distinct names", () => {
  expect(listProjects(["/a/api", "/b/api"])).toEqual([
    { name: "api", folder: "/a/api", dev: false },
    { name: "api (b)", folder: "/b/api", dev: false },
  ]);
});
