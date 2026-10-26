import { expect } from "bun:test";
import { decided, link, open } from "../src/map/mark-fixtures.ts";
import { type Ctx, t } from "./helpers.ts";

const shows = async (ctx: Ctx, id: string) => (await ctx.werk("show", id)).code === 0;

t("08.1 remove takes the subtree in one step and restore brings it back", async (ctx) => {
  ctx.seed(
    ...open("root", { title: "Root" }),
    ...decided("auth", { parent: "root", title: "Auth" }),
    ...open("login", { parent: "auth", title: "Login" }),
    ...open("session", { parent: "auth", title: "Session" }),
    ...open("audit", { parent: "root", title: "Audit" }),
    link("login", "audit"),
  );
  const before = ctx.eventCount();
  const removed = await ctx.werk("remove", "auth", "--actor", "you");
  expect(removed.code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(await shows(ctx, id)).toBe(false);
  expect(ctx.eventCount()).toBe(before + 1);
  const list = await ctx.werk("removed");
  expect(list.stdout).toContain("auth");
  expect(list.stdout).toContain("login");
  expect(list.stdout).toContain("session");
  expect((await ctx.werk("show", "audit")).stdout).not.toContain("login");
  expect((await ctx.werk("restore", "auth", "--actor", "you")).code).toBe(0);
  expect(await shows(ctx, "auth")).toBe(true);
  expect((await ctx.werk("show", "auth")).stdout).toContain("login");
  expect((await ctx.werk("show", "audit")).stdout).toContain("login");
  expect((await ctx.werk("removed")).stdout.trim()).toBe("");
});

t("08.2 remove with reparent moves children up and restore puts them back", async (ctx) => {
  ctx.seed(
    ...open("platform", { title: "Platform" }),
    ...open("auth", { parent: "platform", title: "Auth" }),
    ...open("login", { parent: "auth", title: "Login" }),
    ...open("session", { parent: "auth", title: "Session" }),
  );
  const r = await ctx.werk("remove", "auth", "--actor", "you", "--reparent");
  expect(r.code).toBe(0);
  expect(await shows(ctx, "auth")).toBe(false);
  const platform = (await ctx.werk("show", "platform")).stdout;
  expect(platform).toContain("login");
  expect(platform).toContain("session");
  expect((await ctx.werk("restore", "auth", "--actor", "you")).code).toBe(0);
  const auth = (await ctx.werk("show", "auth")).stdout;
  expect(auth).toContain("login");
  expect(auth).toContain("session");
  const platformAfter = (await ctx.werk("show", "platform")).stdout;
  expect(platformAfter).not.toMatch(/<- refines\s+login/);
});

t("08.3 a link waits until both ends are back", async (ctx) => {
  ctx.seed(
    ...open("root", { title: "Root" }),
    ...open("a", { parent: "root", title: "Branch A" }),
    ...open("b", { parent: "root", title: "Branch B" }),
    ...open("login", { parent: "a", title: "Login" }),
    ...open("session", { parent: "b", title: "Session" }),
    link("login", "session"),
  );
  expect((await ctx.werk("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await ctx.werk("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await ctx.werk("restore", "login", "--actor", "you")).code).toBe(0);
  expect(await shows(ctx, "login")).toBe(true);
  expect((await ctx.werk("show", "login")).stdout).not.toContain("session");
  expect((await ctx.werk("restore", "session", "--actor", "you")).code).toBe(0);
  expect((await ctx.werk("show", "login")).stdout).toContain("session");
});

t("08.4 a removed id stays taken and a cited source stays", async (ctx) => {
  ctx.seed(
    ...open("root", { title: "Root" }),
    ...open("login", { parent: "root", title: "Login" }),
    ...open("billing", { parent: "root", title: "Billing" }),
    ...open("rfc-6749", { kind: "source", title: "RFC 6749" }),
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  );
  expect((await ctx.werk("remove", "login", "--actor", "you")).code).toBe(0);
  const billing = (await ctx.werk("show", "billing")).stdout;
  expect(billing).toContain("rfc-6749");
  const before = ctx.eventCount();
  const add = await ctx.werk("add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toContain("restore");
  expect(ctx.eventCount()).toBe(before);
});

t("08.5 remove without --actor you refuses", async (ctx) => {
  ctx.seed(...open("login", { title: "Login" }));
  const before = ctx.eventCount();
  const r = await ctx.werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect((await ctx.werk("show", "login")).code).toBe(0);
  expect(ctx.eventCount()).toBe(before);
});

t("08.6 restore without --actor you refuses", async (ctx) => {
  ctx.seed(...open("login", { title: "Login" }), { type: "node.removed", id: "login" });
  const before = ctx.eventCount();
  const r = await ctx.werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect((await ctx.werk("show", "login")).code).not.toBe(0);
  expect(ctx.eventCount()).toBe(before);
});
