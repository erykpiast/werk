import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachmentsOf, findImage, storeImage } from "./attachments.ts";
import { MAX_IMAGE_BYTES } from "./image-rules.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
let dir = "";
const make = () => {
  dir = mkdtempSync(join(tmpdir(), "werk-att-"));
  mkdirSync(join(dir, ".werk"));
  return join(dir, ".werk", "log.jsonl");
};
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("a stored image is a file in the attachments folder that ignores itself", () => {
  const log = make();
  const stored = storeImage(log, PNG);
  if (!stored.ok) throw new Error("the image was refused");
  expect(readFileSync(join(attachmentsOf(log), stored.name))).toEqual(
    Buffer.from(PNG),
  );
  expect(readFileSync(join(attachmentsOf(log), ".gitignore"), "utf8")).toBe(
    "*\n",
  );
  expect(findImage(log, stored.name)).toBe(
    join(attachmentsOf(log), stored.name),
  );
});

test("a refused image stores nothing", () => {
  const log = make();
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(PNG);
  expect(storeImage(log, big)).toMatchObject({ ok: false, status: 413 });
  expect(storeImage(log, new TextEncoder().encode("x"))).toMatchObject({
    ok: false,
  });
  expect(readdirSync(join(dir, ".werk"))).toEqual([]);
});

test("a name finds a file only inside the folder", () => {
  const log = make();
  const stored = storeImage(log, PNG);
  expect(stored.ok).toBe(true);
  for (const name of [
    "",
    ".",
    "..",
    "../log.jsonl",
    ".gitignore",
    "20260101-000000000Z-00000000.png",
  ]) {
    expect(findImage(log, name)).toBeNull();
  }
  // A directory that has a stored name is no file.
  mkdirSync(join(attachmentsOf(log), "20260101-000000000Z-aaaaaaaa.png"));
  expect(findImage(log, "20260101-000000000Z-aaaaaaaa.png")).toBeNull();
});
