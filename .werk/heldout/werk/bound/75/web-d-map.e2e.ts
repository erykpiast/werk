// Held-out steps 69.1 to 69.4: the map in a browser, live updates, the open card, and the server lock.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";
import { cleanEnv } from "../src/test/clean-env.ts";

test.afterEach(stop);

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

test("69.1 the map shows the project as a refines tree", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.added", { id: "child-a", kind: "card", title: "Child card A", parent: "root" });
    down.seed("node.added", { id: "child-b", kind: "card", title: "Child card B", parent: "root" });
    down.seed("node.added", { id: "grand-a", kind: "card", title: "Grandchild under A", parent: "child-a" });
  });
  await p.goto(`${w.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  const sub = p.locator('[data-section="subcards"]');
  await expect(sub.locator('a[data-tile="child-a"]')).toContainText("Child card A");
  await expect(sub.locator('a[data-tile="child-b"]')).toContainText("Child card B");
  await expect(p.locator('a[data-tile="grand-a"]')).toHaveCount(0);

  await sub.locator('a[data-tile="child-a"]').click();
  await expect(p).toHaveURL(/\/map\/child-a$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Child card A");
  await expect(p.locator('[data-section="subcards"] a[data-tile="grand-a"]')).toContainText("Grandchild under A");
});

test("69.2 a card added and accepted from the command line appears with no reload", async ({ page: p }) => {
  const w = await project();
  let navigations = 0;
  await p.goto(`${w.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  p.on("framenavigated", (frame) => {
    if (frame === p.mainFrame()) navigations += 1;
  });
  await expect(p.locator("body")).not.toContainText("Use an append-only log");

  w.werk("add", "append-log", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "append-log", "--actor", "you");

  const tile = p.locator('[data-section="subcards"] a[data-tile="append-log"]');
  await expect(tile).toContainText("Use an append-only log", { timeout: 5000 });
  await expect(tile).toHaveAttribute("data-proposed", "false");
  expect(navigations).toBe(0);
});

test("69.3 the open card survives a reload and has no control that edits its text", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.added", {
      id: "child-a",
      kind: "card",
      title: "Child card A",
      body: "The body of child A",
      parent: "root",
    });
  });
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="child-a"]').click();
  await expect(p).toHaveURL(/\/map\/child-a$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Child card A");
  await expect(p.locator('[data-field="body"]')).toHaveText("The body of child A");

  // No text box, editable region or edit button that changes the title or the body.
  const view = p.locator("#view");
  await expect(view.locator("[contenteditable]:not([contenteditable='false'])")).toHaveCount(0);
  await expect(
    view.locator("h1 input, h1 textarea, [data-field='body'] input, [data-field='body'] textarea"),
  ).toHaveCount(0);
  await expect(view.getByRole("textbox", { name: /title|body/i })).toHaveCount(0);
  await expect(view.getByRole("button", { name: /edit|title|body|rename/i })).toHaveCount(0);
  const boxes = await view.getByRole("textbox").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  for (const label of boxes) expect(label).not.toMatch(/title|body/i);

  await p.reload();
  await expect(p).toHaveURL(/\/map\/child-a$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Child card A");
});

test("69.4 a second server on the same project waits, then refuses", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    down.seed("node.added", { id: "child-a", kind: "card", title: "Child card A", parent: "root" });
  });
  await p.goto(`${w.url}/map`);
  await expect(p.locator('a[data-tile="child-a"]')).toContainText("Child card A");
  const lock = JSON.parse(readFileSync(join(w.dir, ".werk", "serve.lock"), "utf8")) as { pid: number };
  const firstPid = lock.pid;

  const env = cleanEnv(process.env, FAKE_BIN);
  const started = Date.now();
  const second = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: w.dir, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let firstOutputAt: number | undefined;
  const onData = (chunk: Buffer) => {
    if (firstOutputAt === undefined) firstOutputAt = Date.now() - started;
    output += chunk.toString();
  };
  second.stdout?.on("data", onData);
  second.stderr?.on("data", onData);
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      second.kill("SIGTERM");
      resolve(null);
    }, 12000);
    second.on("exit", (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  const elapsed = Date.now() - started;
  console.log(
    `69.4 second server: code=${code} elapsed=${elapsed}ms firstOutputAt=${firstOutputAt}ms output=${JSON.stringify(output)}`,
  );

  // It prints that it waits, naming the first server's pid, before it refuses.
  expect
    .soft(firstOutputAt !== undefined && firstOutputAt < elapsed - 1000, "a wait line printed before the refusal")
    .toBe(true);
  expect
    .soft(output, "a line that says it waits for the pid")
    .toMatch(new RegExp(`wait[^\\n]*${firstPid}|${firstPid}[^\\n]*wait`, "i"));
  // Within about 5 seconds it stops with an error that names the pid.
  expect.soft(code, "exit code").not.toBe(0);
  expect.soft(code, "exit code").not.toBeNull();
  expect.soft(elapsed, "time to stop").toBeLessThan(8000);
  expect.soft(output).toContain(String(firstPid));

  // The first server still serves the same map.
  await p.goto(`${w.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.locator('a[data-tile="child-a"]')).toContainText("Child card A");
});
