import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanEnv } from "../../src/test-env/env.ts";
import { expect, test } from "@playwright/test";
import {
  chat,
  devServer,
  leftPane,
  markLoaded,
  serverWith,
  stillLoaded,
} from "./g3-support.ts";

const ROOT_TITLE = "We build software with agents";

test("14.1 a card added from the command line appears on the open page without a reload", async ({
  page,
}) => {
  const server = await serverWith({});
  try {
    await page.goto(server.url);
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE }),
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

    await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
    await expect(composer).toHaveValue("half a thought");
    await expect(chat(page)).toBeVisible();
  } finally {
    await server.dispose();
  }
});

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({
  page,
}) => {
  const dev = await devServer();
  try {
    await page.goto(dev.url);
    await expect(
      leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE }),
    ).toBeVisible();
    await markLoaded(page);
    const origin = new URL(dev.url).origin;
    const before = await (await fetch(`${origin}/api/projects`)).json();
    expect(before.edited).toBeUndefined();

    const routes = join(dev.appDir, "src", "serve", "routes.ts");
    const source = readFileSync(routes, "utf8");
    const needle = "return json({ projects: entries(ctx.projects) });";
    expect(source).toContain(needle);
    writeFileSync(
      routes,
      source.replace(
        needle,
        "return json({ projects: entries(ctx.projects), edited: true });",
      ),
    );

    await expect
      .poll(() => dev.output(), { timeout: 20000 })
      .toContain("reusing the live server");
    expect(dev.output()).toContain(`port ${dev.port}`);
    await expect
      .poll(
        async () =>
          ((await (await fetch(`${origin}/api/projects`)).json()) as {
            edited?: boolean;
          }).edited,
        { timeout: 20000 },
      )
      .toBe(true);
    // the same process still answers on the same port
    process.kill(dev.pid, 0);

    const werk = spawnSync(
      "bun",
      [join(dev.appDir, "src", "cli.ts"), "add", "after", "--title", "After edit", "--parent", "root"],
      { cwd: dev.dir, env: cleanEnv(process.env), encoding: "utf8" },
    );
    expect(werk.status, werk.stderr).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    await dev.dispose();
  }
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
}) => {
  const dev = await devServer();
  try {
    await page.goto(dev.url);
    const heading = leftPane(page).getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(ROOT_TITLE);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("draft that must survive");
    await markLoaded(page);

    const entry = join(dev.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);

    await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
    await expect(heading).toHaveText(ROOT_TITLE);
    await expect(composer).toHaveValue("draft that must survive");
  } finally {
    await dev.dispose();
  }
});
