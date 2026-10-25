import { expect, test } from "bun:test";
import type { Context } from "../projects/context.ts";
import { clearRoute, modelRoute } from "./chat-route.ts";

// A GET must be refused before any session is built, so the context can be empty.
const context = {} as Context;

test("a GET to the clear route is refused and clears nothing", async () => {
  const res = await clearRoute(context, {}, new Request("http://x/clear"));
  expect(res.status).toBe(405);
});

test("a GET to the model route is refused with 405", async () => {
  const res = await modelRoute(context, {}, new Request("http://x/model"));
  expect(res.status).toBe(405);
});
