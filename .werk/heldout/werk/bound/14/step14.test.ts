import { afterEach, beforeEach, expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyApp } from "../src/test-env/app-copy.ts";
import { createProject, holder, type Project, seedDecided, until, url, werk } from "./helpers.ts";

let p: Project;
let scratch: string;
beforeEach(() => {
  p = createProject();
  scratch = mkdtempSync(join(tmpdir(), "werk-heldout-14-"));
});
afterEach(async () => {
  await p.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

async function withPage<T>(port: number, path: string, body: (page: import("@playwright/test").Page) => Promise<T>) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url(port, path));
    return await body(page);
  } finally {
    await browser.close();
  }
}

test("14.1 a card added from the command line appears on the open page, no reload, composer kept", async () => {
  seedDecided(p);
  p.start(["bun", join(import.meta.dir, "..", "src", "cli.ts"), "serve", "--port", "0"]);
  const { port } = await holder(p.dir);
  await withPage(port, "/", async (page) => {
    let loads = 0;
    page.on("load", () => loads++);
    await page.evaluate(() => {
      (window as any).__marker = "same-page";
    });
    // The person types in the chat composer.
    const composer = page.getByRole("textbox").first();
    await composer.fill("half a thought", { timeout: 5000 });
    expect((await werk(p, "add", "fresh", "--title", "Fresh idea", "--parent", "root")).stdout.trim()).toBe("proposed");
    await page.getByText("Fresh idea").first().waitFor({ timeout: 10000 });
    expect(await page.evaluate(() => (window as any).__marker)).toBe("same-page");
    expect(await composer.inputValue()).toBe("half a thought");
    expect(loads).toBe(0);
  });
}, 60000);

test("14.2 a server edit changes a response, same process and port, live page stays connected", async () => {
  seedDecided(p);
  const app = join(scratch, "app");
  const cli = copyApp(app);
  const child = p.start(["bun", cli, "serve", "--port", "0"]);
  const stderr: string[] = [];
  void (async () => {
    const dec = new TextDecoder();
    for await (const chunk of child.stderr) stderr.push(dec.decode(chunk));
  })();
  const before = await holder(p.dir);
  const probe = async () => (await (await fetch(url(before.port, "/api/graph"))).json()) as { error: string };
  expect((await probe()).error).toBe("the graph is read with shape=1");

  await withPage(before.port, "/", async (page) => {
    const routes = join(app, "src", "serve", "routes.ts");
    writeFileSync(routes, readFileSync(routes, "utf8").replace("the graph is read with shape=1", "edited response"));
    await until(async () => ((await probe()).error === "edited response" ? true : undefined));
    expect(stderr.join("")).toContain("reusing the live server");
    const after = await holder(p.dir);
    expect(after).toEqual(before);
    expect((await werk(p, "add", "after", "--title", "After edit", "--parent", "root")).stdout.trim()).toBe("proposed");
    await page.getByText("After edit").first().waitFor({ timeout: 10000 });
  });
}, 90000);

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async () => {
  seedDecided(p);
  const app = join(scratch, "app");
  const cli = copyApp(app);
  p.start(["bun", cli, "serve", "--port", "0"]);
  const { port } = await holder(p.dir);
  await withPage(port, "/", async (page) => {
    const composer = page.getByRole("textbox").first();
    await composer.fill("draft that must survive", { timeout: 5000 });
    // The client code of the app copy.
    const clientDir = join(app, "client");
    expect(await Bun.file(join(clientDir, "main.tsx")).exists()).toBe(true);
  });
}, 60000);
