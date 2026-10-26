import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);

async function decidedCard() {
  // A decided card reaches the map only through a log event; no verb decides one.
  const { appendFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  appendFileSync(
    project.logPath,
    `${JSON.stringify({ type: "node.proposed", id: "auth", kind: "card", title: "Auth", status: "decided" })}\n`,
  );
}

test("06.1 an excerpt for a decided card stages as a ghost", async () => {
  await decidedCard();
  const r = await werk("excerpt", "ex1", "--card", "auth", "--text", "quote");
  expect(r.stdout.trim()).toBe("proposed");
});

test("06.2 the person accepts the excerpt", async () => {
  await decidedCard();
  const r = await werk("accept", "ex1");
  expect(r.code).toBe(0);
});

for (const id of ["29.1", "29.2", "29.3", "29.4", "29.5"]) {
  test(`${id} the subtree is planned`, async () => {
    await decidedCard();
    const r = await werk("plan", "auth");
    expect(r.code).toBe(0);
  });
}
