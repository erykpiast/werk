import { afterEach, expect, test } from "bun:test";
import { decided, lines, mk, open, type Project } from "./h.ts";

let p: Project | undefined;
afterEach(() => p?.dispose());

test("05.1 add proposes a card and show reads it back", async () => {
  const { project, werk } = mk(decided("auth"));
  p = project;
  const before = lines(project).length;
  const add = await werk("add", "login", "--title", "Use magic links", "--parent", "auth");
  expect(add.stdout.trim()).toBe("proposed");
  expect(lines(project).length).toBe(before + 1);
  const shown = (await werk("show", "login")).stdout;
  expect(shown).toContain("Use magic links");
  expect(shown).toContain("proposed");
  expect(shown).toContain("auth");
  expect(shown).toContain("rollup:");
});

test("05.2 duplicate id refused", async () => {
  const { project, werk } = mk(decided("auth"));
  p = project;
  await werk("add", "login", "--title", "First words", "--parent", "auth");
  const n = lines(project).length;
  const r = await werk("add", "login", "--title", "Other words", "--parent", "auth");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("duplicate-id");
  expect(lines(project).length).toBe(n);
  expect((await werk("show", "login")).stdout).toContain("First words");
});

test("05.3 decided status refused on add", async () => {
  const { project, werk } = mk(decided("auth"));
  p = project;
  const n = lines(project).length;
  const r = await werk("add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr.toLowerCase()).toContain("decided");
  expect(r.stderr.toLowerCase()).toContain("not add");
  expect(lines(project).length).toBe(n);
  const s = await werk("show", "pay");
  expect(s.stderr.toLowerCase()).toContain("unknown card");
});

test("05.4 hash optional on ids, kept in titles", async () => {
  const { project, werk } = mk(open("auth"));
  p = project;
  const r = await werk("add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(r.stdout.trim()).toBe("proposed");
  const a = (await werk("show", "#login")).stdout;
  const b = (await werk("show", "login")).stdout;
  expect(a).toBe(b);
  expect(a).toContain("#1 priority: magic links");
  expect(a).toContain("auth");
});

test("05.5 hand-written bad line listed, later cards show", async () => {
  const { project, werk } = mk([
    ...open("auth"),
    JSON.stringify({ type: "node.proposed", id: "orphan", kind: "card", title: "Orphan", status: "open", parent: "nowhere" }),
    JSON.stringify({ type: "node.proposed", id: "login", kind: "card", title: "Login", status: "open", parent: "auth" }),
  ]);
  p = project;
  const before = lines(project).join("\n");
  const shown = await werk("show", "login");
  expect(shown.stdout).toContain("[open]");
  expect(shown.stdout).toContain("proposed");
  // the problems of the map: show prints them on stderr with the log line
  expect(shown.stderr).toContain("log line 3");
  expect(shown.stderr).toContain("unknown-card");
  expect(lines(project).join("\n")).toBe(before);
  expect(lines(project)[2]).toContain("orphan");
});
