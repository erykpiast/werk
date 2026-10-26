import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv } from "../../src/test-env/env.ts";
import { startBrowserServer } from "../../e2e/support/server.ts";

const ROOT_LOG = `${[
  '{"type":"node.proposed","id":"root","kind":"card","title":"Root","status":"open","why":"The start."}',
  '{"type":"node.accepted","id":"root","actor":"you"}',
].join("\n")}\n`;

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { loaded?: boolean }).loaded === true,
  );
const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

test("14.1 a card added from the command line appears on the open page without a reload", async ({
  page,
}) => {
  const server = await startBrowserServer();
  try {
    mkdirSync(join(server.dir, ".werk"), { recursive: true });
    writeFileSync(join(server.dir, ".werk", "log.jsonl"), ROOT_LOG);
    await server.start();
    await page.goto(server.url);
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
    ).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("half a thought");
    await markLoaded(page);

    const added = server.werk(
      "add",
      "fresh",
      "--title",
      "Fresh idea",
      "--parent",
      "root",
    );
    expect(added.code).toBe(0);

    await expect(leftPane(page).getByText("Fresh idea")).toBeVisible({
      timeout: 20000,
    });
    expect(await stillLoaded(page)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
  } finally {
    await server.dispose();
  }
});

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-dev-"));
  const dir = join(root, "project");
  const appDir = join(root, "app");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  writeFileSync(join(dir, ".werk", "log.jsonl"), ROOT_LOG);
  const cli = copyApp(appDir);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = { ...cleanEnv(process.env) };
  let output = "";
  let child: ChildProcess | undefined;
  try {
    child = spawn("bun", [cli, "serve", "--port", String(port)], {
      cwd: dir,
      env: { ...env, WERK_DEV: "1" },
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk) => {
        output += String(chunk);
      });
    }
    await expect
      .poll(
        async () =>
          (await fetch(`${url}/api/graph?shape=1`).catch(() => null))?.ok ===
          true,
        { timeout: 60000 },
      )
      .toBe(true);
    await page.goto(url);
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
    ).toBeVisible();
    await markLoaded(page);

    const pidBefore = /serving on .* \(pid (\d+)\)/.exec(output)?.[1];
    expect(pidBefore).toBeDefined();
    const before = await fetch(`${url}/api/heldout-ping`);
    expect(before.status).toBe(404);

    const routes = join(appDir, "src", "serve", "routes.ts");
    writeFileSync(
      routes,
      readFileSync(routes, "utf8").replace(
        'if (url.pathname === "/api/live")',
        'if (url.pathname === "/api/heldout-ping") return json({ edited: true });\n    if (url.pathname === "/api/live")',
      ),
    );

    await expect
      .poll(
        async () =>
          (await fetch(`${url}/api/heldout-ping`).catch(() => null))?.status,
        { timeout: 30000 },
      )
      .toBe(200);
    expect(await (await fetch(`${url}/api/heldout-ping`)).json()).toEqual({
      edited: true,
    });
    expect(output).toContain("reusing the live server");
    expect(output.match(/serving on/g)).toHaveLength(1);
    expect(() => process.kill(Number(pidBefore), 0)).not.toThrow();
    expect(output).toContain(`:${port}`);

    const added = spawnSync(
      "bun",
      [cli, "add", "after", "--title", "After edit", "--parent", "root"],
      { cwd: dir, env, encoding: "utf8" },
    );
    expect(added.status).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible({
      timeout: 20000,
    });
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise((done) => child?.once("exit", done));
      child.kill("SIGTERM");
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
}) => {
  const server = await startBrowserServer({ appCopy: true });
  try {
    mkdirSync(join(server.dir, ".werk"), { recursive: true });
    writeFileSync(join(server.dir, ".werk", "log.jsonl"), ROOT_LOG);
    await server.start();
    await page.goto(server.url);
    const heading = leftPane(page).getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    const title = await heading.innerText();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("draft that must survive");
    await markLoaded(page);

    const entry = join(server.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);

    await expect.poll(() => stillLoaded(page), { timeout: 30000 }).toBe(false);
    await expect(heading).toHaveText(title);
    await expect(composer).toHaveValue("draft that must survive");
  } finally {
    await server.dispose();
  }
});
