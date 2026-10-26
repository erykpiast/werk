import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { createProject, holder, type Project, seedDecided, url, werk } from "./helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(async () => {
  await p.dispose();
});

const ex = (ev: object) => appendFileSync(p.logPath, `${JSON.stringify(ev)}\n`);

// 06.1: the step's action is an agent adding an excerpt through the command line.
test("06.1 an agent adds an excerpt for a decided card: output says proposed", async () => {
  seedDecided(p);
  const r = await werk(p, "add", "ex1", "--title", "A quote", "--kind", "excerpt", "--parent", "root");
  expect(r.stderr).toBe("");
  expect(r.stdout.trim()).toBe("proposed");
  expect(r.code).toBe(0);
});

// Same checks of 06.1 with the excerpt put in the log by hand, to see what the map does with a ghost excerpt.
test("06.1 (fixture) a ghost excerpt is held, its link is pending, the card is unchanged", async () => {
  seedDecided(p);
  ex({ type: "node.proposed", id: "ex1", kind: "excerpt", title: "A quote", status: "open" });
  ex({ type: "edge.added", from: "root", to: "ex1", link: "supported_by" });
  const card = await werk(p, "show", "root");
  expect(card.stdout).toContain("[decided]");
  expect(card.stdout).toMatch(/supported_by\s+ex1.*\[proposed\]\s+\[held\]/);
  const e = await werk(p, "show", "ex1");
  expect(e.stdout).toMatch(/excerpt ex1.*proposed/);
});

test("06.2 accepted excerpt is no ghost; link live; card view shows it as evidence", async () => {
  seedDecided(p);
  ex({ type: "node.proposed", id: "ex1", kind: "excerpt", title: "A quote", status: "open" });
  ex({ type: "edge.added", from: "root", to: "ex1", link: "supported_by" });
  const acc = await werk(p, "accept", "ex1", "--actor", "you");
  expect(acc.stdout.trim()).toBe("accepted");
  const card = await werk(p, "show", "root");
  expect(card.stdout).toMatch(/supported_by\s+ex1/);
  expect(card.stdout).not.toMatch(/\[held\]|\[proposed\]/);
  expect(p.events().filter((e: any) => e.type === "edge.added")).toHaveLength(1);

  // The card view: a page of the browser for the card.
  p.start(["bun", `${import.meta.dir}/../src/cli.ts`, "serve", "--port", "0"]);
  const { port } = await holder(p.dir);
  const api = await (await fetch(url(port, "/api/card/root"))).json();
  expect(api.card.neighbours).toContainEqual(expect.objectContaining({ id: "ex1", type: "supported_by" }));
  const pageRes = await fetch(url(port, "/card/root"));
  const html = await pageRes.text();
  expect(pageRes.status).toBe(200);
  expect(html).toContain("A quote");
});
