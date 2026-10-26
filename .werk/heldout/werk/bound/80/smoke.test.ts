import { expect, test } from "bun:test";
import { mk } from "./lib.ts";
test("smoke", async () => {
  const h = mk();
  h.card("a", { title: "Checkout flow", status: "decided" });
  const r = await h.w("add", "b", "--title", "Retry", "--parent", "a");
  expect(r.out).toContain("proposed");
  expect((await h.w("show", "b")).out).toContain("proposed");
});
