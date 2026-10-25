import { expect, test } from "bun:test";
import {
  checkImage,
  imageFileName,
  imageHeader,
  isStoredName,
  MAX_IMAGE_BYTES,
  mimeOfName,
  sniffImage,
} from "./image-rules.ts";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0];
const bytes = (head: number[], size = head.length) => {
  const out = new Uint8Array(size);
  out.set(head);
  return out;
};
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

test("the first bytes name the four image types", () => {
  expect(sniffImage(bytes(PNG))).toBe("png");
  expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
  expect(sniffImage(bytes([0x47, 0x49, 0x46, 0x38, 0x39]))).toBe("gif");
  expect(sniffImage(bytes(WEBP))).toBe("webp");
  expect(sniffImage(new TextEncoder().encode("hello"))).toBeNull();
  expect(
    sniffImage(bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 1, 1, 1, 1])),
  ).toBeNull();
});

test("an empty, oversized or foreign upload is refused with a reason", () => {
  expect(checkImage(bytes(PNG))).toEqual({ ok: true, type: "png" });
  expect(checkImage(new Uint8Array(0))).toMatchObject({
    ok: false,
    status: 400,
  });
  const big = checkImage(bytes(PNG, MAX_IMAGE_BYTES + 1));
  expect(big).toMatchObject({ ok: false, status: 413 });
  expect(big.ok === false && big.message).toContain("20 MB");
  expect(checkImage(bytes(PNG, MAX_IMAGE_BYTES))).toMatchObject({ ok: true });
  expect(checkImage(new TextEncoder().encode("text"))).toMatchObject({
    ok: false,
    status: 415,
  });
});

test("a stored name carries the time, a random part and the extension", () => {
  const name = imageFileName(
    "jpeg",
    new Date("2026-10-25T12:34:56.789Z"),
    "bf34ecf0",
  );
  expect(name).toBe("20261025-123456789Z-bf34ecf0.jpg");
  expect(isStoredName(name)).toBe(true);
  expect(mimeOfName(name)).toBe("image/jpeg");
  expect(mimeOfName("20261025-123456789Z-bf34ecf0.png")).toBe("image/png");
});

test("a name that is empty, a path or another file is not a stored name", () => {
  for (const name of [
    "",
    ".",
    "..",
    "../x.png",
    "a/b.png",
    "shot.png",
    ".gitignore",
  ]) {
    expect(isStoredName(name)).toBe(false);
    expect(mimeOfName(name)).toBeNull();
  }
});

test("the header maps each token to its path and tells the agent to read them", () => {
  expect(imageHeader([])).toBe("");
  expect(imageHeader(["/a.png", "/b.png"])).toBe(
    "[Image #1] = /a.png\n[Image #2] = /b.png\n\nOpen each image above with Read before you answer.",
  );
});
