import { expect, test } from "bun:test";
import { parsePinnedVersion } from "./toolchain";

test("the pinned Bun version is the version that runs the tests", async () => {
  const file = await Bun.file(`${import.meta.dir}/../.bun-version`).text();
  expect(parsePinnedVersion(file)).toBe(Bun.version);
});

test("a pinned version file may end with a newline", () => {
  expect(parsePinnedVersion("1.4.1\n")).toBe("1.4.1");
});
