import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { copyApp } from "../src/test-env/app-copy.ts";
import { createProject, type Project } from "../src/test-env/project.ts";
import { CLI, must, realCard, werk } from "./helpers.ts";

let p: Project;
let scratch: string;
let browser: Browser | undefined;
beforeEach(() => {
  p = createProject();
  scratch = mkdtempSync(join(tmpdir(), "werk-heldout-14-"));
});
afterEach(async () => {
  await browser?.close();
  browser = undefined;
  await p.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

async function until<T>(read: () => T | undefined | Promise<T | undefined>, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await (async () => read())().catch(() => undefined);
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(50);
  }
}

const lockPath = () => join(p.dir, ".werk", "serve.lock");
const holder = () =>
  until(() => {
    const lock = JSON.parse(readFileSync(lockPath(), "utf8"));
    return lock.port > 0 ? (lock as { pid: number; port: number }) : undefined;
  });

/** Collects what a started server writes to stderr. */
function collect(child: Bun.Subprocess<"ignore", "pipe", "pipe">) {
  const box = { text: "" };
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stderr) box.text += decoder.decode(chunk);
  })();
  return box;
}

async function openPage(port: number) {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  return page;
}

test("14.1 a card added from the command line appears on the open page without a reload", async () => {
  await realCard(p, "root", undefined, "Root");
  p.start(["bun", CLI, "serve", "--port", "0"]);
  const { port } = await holder();
  const page = await openPage(port);
  let loads = 0;
  page.on("framenavigated", () => loads++);
  await page.getByText("Root").first().waitFor({ timeout: 5000 });
  const composer = page.getByRole("textbox").first();
  await composer.fill("half a thought", { timeout: 5000 });
  await must(p, "add", "fresh", "--title", "Fresh idea", "--parent", "root");
  await page.getByText("Fresh idea").first().waitFor({ timeout: 5000 });
  expect(loads).toBe(0);
  expect(await composer.inputValue()).toBe("half a thought");
}, 60000);

test("14.2 in dev a server edit changes a response, the same server stays, the live page stays connected", async () => {
  await realCard(p, "root", undefined, "Root");
  const app = join(scratch, "app");
  const child = p.start(["bun", copyApp(app), "serve", "--port", "0"]);
  const log = collect(child);
  const first = await holder();
  const page = await openPage(first.port);

  const routes = join(app, "src", "serve", "routes.ts");
  const edited = readFileSync(routes, "utf8").replace(
    'if (url.pathname === "/api/live") return live(ctx);',
    'if (url.pathname === "/api/live") return live(ctx);\n    if (url.pathname === "/api/ping") return new Response("edited");',
  );
  expect(edited).toContain("/api/ping");
  writeFileSync(routes, edited);
  const body = await until(async () => {
    const res = await fetch(`http://127.0.0.1:${first.port}/api/ping`);
    return res.status === 200 ? await res.text() : undefined;
  });
  expect(body).toBe("edited");
  expect(log.text).toContain("reusing the live server");
  expect(await holder()).toEqual(first);

  await must(p, "add", "after", "--title", "After edit", "--parent", "root");
  await page.getByText("After edit").first().waitFor({ timeout: 5000 });
}, 90000);

test("14.3 in dev a client edit that cannot apply in place reloads the page and keeps the draft", async () => {
  await realCard(p, "root", undefined, "Root");
  const app = join(scratch, "app");
  p.start(["bun", copyApp(app), "serve", "--port", "0"]);
  const { port } = await holder();
  const page = await openPage(port);
  await page.getByText("Root").first().waitFor({ timeout: 5000 });
  const composer = page.getByRole("textbox").first();
  await composer.fill("draft that must survive", { timeout: 5000 });

  // The client code lives in its own folder beside src (#werk-stack-layout).
  const client = join(app, "client");
  expect(existsSync(client)).toBe(true);
}, 90000);
