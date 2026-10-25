import { expect, test } from "bun:test";
import { pieGradient, pieOf } from "./context-pie";

test("the band is blue under a third, yellow from a third, red from two thirds", () => {
  expect(pieOf(0, 200_000).level).toBe("blue");
  expect(pieOf(66_000, 200_000).level).toBe("blue");
  expect(pieOf(200_000 / 3, 200_000).level).toBe("yellow");
  expect(pieOf(130_000, 200_000).level).toBe("yellow");
  expect(pieOf(400_000 / 3, 200_000).level).toBe("red");
  expect(pieOf(190_000, 200_000).level).toBe("red");
});

test("the share is a whole percent, kept inside the circle", () => {
  expect(pieOf(150_000, 200_000)).toMatchObject({
    percent: 75,
    fraction: 0.75,
  });
  expect(pieOf(300_000, 200_000).percent).toBe(100);
  expect(pieOf(5, 0)).toMatchObject({ percent: 0, level: "blue" });
});

test("the gradient fills the share in the colour of the band", () => {
  expect(pieGradient(pieOf(100_000, 200_000))).toBe(
    "conic-gradient(var(--status-open) 180.0deg, var(--color-border) 0)",
  );
  expect(pieGradient(pieOf(0, 200_000))).toContain(
    "var(--status-proto) 0.0deg",
  );
});
