import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readMap } from "../map/log-store.ts";
import { createProject, type Project } from "../test-env/project.ts";
import { cardActionRoute } from "./card-action-route.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(async () => {
  await project.dispose();
});

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: id,
  status: "open",
  ...extra,
});

function seed(...events: unknown[]) {
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(
    project.logPath,
    events.map((event) => `${JSON.stringify(event)}\n`).join(""),
  );
}

function append(event: unknown) {
  appendFileSync(project.logPath, `${JSON.stringify(event)}\n`);
}

const post = (action: "accept" | "remove", body: unknown) =>
  cardActionRoute(
    project.logPath,
    action,
    new Request("http://localhost/x", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const nodes = () => [...readMap(project.logPath).map.nodes.keys()];

test("an accept makes a ghost a normal card", async () => {
  seed(
    node("root"),
    { type: "node.accepted", id: "root", actor: "you" },
    node("g", { parent: "root" }),
  );
  expect(readMap(project.logPath).map.nodes.get("g")?.proposed).toBe(true);
  const res = await post("accept", { card: "g" });
  expect(res.status).toBe(200);
  expect(readMap(project.logPath).map.nodes.get("g")?.proposed).toBe(false);
});

test("an accept takes a proposed removal out, and refuses a card with no proposal", async () => {
  seed(
    node("root"),
    { type: "node.accepted", id: "root", actor: "you" },
    node("c", { parent: "root" }),
    { type: "node.accepted", id: "c", actor: "you" },
  );
  const none = await post("accept", { card: "c" });
  expect(none.status).toBe(409);
  expect(((await none.json()) as { error: string }).error).toBe("no-proposal");
  append({ type: "removal.proposed", id: "c" });
  expect((await post("accept", { card: "c" })).status).toBe(200);
  expect(nodes()).toEqual(["root"]);
});

test("a remove with reparent keeps the children in the tree", async () => {
  seed(
    node("root"),
    { type: "node.accepted", id: "root", actor: "you" },
    node("p", { parent: "root" }),
    node("a", { parent: "p" }),
    node("b", { parent: "p" }),
  );
  for (const id of ["p", "a", "b"]) {
    append({ type: "node.accepted", id, actor: "you" });
  }
  const res = await post("remove", { card: "p", reparent: true });
  expect(res.status).toBe(200);
  const { map } = readMap(project.logPath);
  expect([...map.nodes.keys()].sort()).toEqual(["a", "b", "root"]);
  expect(map.parents.get("a")).toBe("root");
});

test("a bad body, a bad id and a refused event answer with a reason", async () => {
  expect((await post("remove", "not json")).status).toBe(400);
  expect((await post("remove", { card: "../x" })).status).toBe(400);
  seed(node("root"));
  const refused = await post("remove", { card: "root" });
  expect(refused.status).toBe(409);
  expect(((await refused.json()) as { error: string }).error).toBe(
    "remove-target",
  );
});
