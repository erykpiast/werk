import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cleanEnv } from "../src/test-env/env.ts";
import { startBrowserServer } from "../e2e/support/server.ts";
import {
  card,
  leftPane,
  markLoaded,
  serverWithLog,
  stillLoaded,
} from "./support.ts";

const rootLog = () => card("root", null, "open", "Root");

test("14.1 a card added from the command line appears with no reload and the draft stays", async ({
  page,
}) => {
  const server = await serverWithLog(rootLog());
  try {
    await page.goto(server.url);
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
    ).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("half a thought");
    await markLoaded(page);
    const r = server.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(r.code).toBe(0);
    await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
  } finally {
    await server.dispose();
  }
});

/** Starts the dev server from an app copy and keeps its log. */
async function devServer() {
  const server = await startBrowserServer({ appCopy: true });
  writeFileSync(
    join(server.dir, ".werk", "log.jsonl"),
    `${rootLog().map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
  const cli = join(server.appDir, "src", "cli.ts");
  const port = new URL(server.origin).port;
  const env = {
    ...cleanEnv(process.env),
    WERK_OPEN: "true",
    WERK_DEV: "1",
    WERK_HOME: server.home,
  };
  const child = spawn("bun", [cli, "serve", "--port", port], {
    cwd: server.dir,
    env,
  });
  let output = "";
  for (const s of [child.stdout, child.stderr])
    s?.on("data", (c) => {
      output += String(c);
    });
  const end = Date.now() + 40000;
  for (;;) {
    const ok = await fetch(`${server.origin}/api/projects`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    if (Date.now() > end) throw new Error(`server did not start:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  const lock = () =>
    JSON.parse(readFileSync(join(server.home, "serve.lock"), "utf8"));
  return {
    server,
    lock,
    log: () => output,
    async dispose() {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      await server.dispose();
    },
  };
}

test("14.2 a server edit changes a response and the live page stays connected", async ({
  page,
}) => {
  const dev = await devServer();
  const { server } = dev;
  try {
    await page.goto(server.url);
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
    ).toBeVisible();
    await markLoaded(page);
    const before = dev.lock();
    const res0 = await fetch(`${server.origin}/api/projects`);
    expect(await res0.json()).not.toHaveProperty("edited");

    const routes = join(server.appDir, "src", "serve", "routes.ts");
    const src = readFileSync(routes, "utf8");
    const target = "return json({ projects: entries(ctx.projects) });";
    expect(src).toContain(target);
    writeFileSync(
      routes,
      src.replace(
        target,
        "return json({ projects: entries(ctx.projects), edited: true });",
      ),
    );

    await expect
      .poll(() => dev.log(), { timeout: 20000 })
      .toContain("reusing the live server");
    await expect
      .poll(
        async () =>
          (
            (await (await fetch(`${server.origin}/api/projects`)).json()) as {
              edited?: boolean;
            }
          ).edited,
        { timeout: 20000 },
      )
      .toBe(true);
    const after = dev.lock();
    expect(after.pid).toBe(before.pid);
    expect(after.port).toBe(before.port);

    const r = server.werk("add", "after", "--title", "After edit", "--parent", "root");
    expect(r.code).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    await dev.dispose();
  }
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
}) => {
  const dev = await devServer();
  const { server } = dev;
  try {
    await page.goto(server.url);
    const h1 = leftPane(page).getByRole("heading", { level: 1 });
    await expect(h1).toHaveText("Root");
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("draft that must survive");
    await markLoaded(page);

    const entry = join(server.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);

    await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
    await expect(h1).toHaveText("Root");
    await expect(composer).toHaveValue("draft that must survive");
  } finally {
    await dev.dispose();
  }
});
