import { expect, test } from "bun:test";
import { staticPath } from "./static-path.ts";

test("the root path is the page", () => {
  expect(staticPath("/")).toBe("index.html");
  expect(staticPath("")).toBe("index.html");
});

test("a file path loses its leading slash and keeps its folders", () => {
  expect(staticPath("/assets/app-1a2b.js")).toBe("assets/app-1a2b.js");
  expect(staticPath("/a//b/./c.css")).toBe("a/b/c.css");
});

test("a path that leaves the folder is refused", () => {
  expect(staticPath("/../secret")).toBeNull();
  expect(staticPath("/a/../../secret")).toBeNull();
  expect(staticPath("/%2e%2e/secret")).toBeNull();
  expect(staticPath("/a%5c..%5csecret")).toBeNull();
});

test("a malformed path is refused", () => {
  expect(staticPath("/%zz")).toBeNull();
  expect(staticPath("/a%00b")).toBeNull();
});
