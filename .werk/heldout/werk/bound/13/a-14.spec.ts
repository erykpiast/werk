import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  card,
  expect,
  leftPane,
  markLoaded,
  stillLoaded,
  test,
} from "./a-support.ts";

const listenerPid = (port: number) =>
  execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .sort()
    .join(",");

test("14.1 a card added from the command line appears with no reload and the draft stays", async ({
  page,
  srv,
}) => {
  const s = await srv({ events: card("root", "Root") });
  await page.goto(s.url);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
  ).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await markLoaded(page);

  const r = s.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  expect(r.code).toBe(0);

  await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.2 in dev a server edit changes a response and the live page stays connected", async ({
  page,
  srv,
}) => {
  const s = await srv({ appCopy: true, events: card("root", "Root") });
  await page.goto(s.url);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
  ).toBeVisible();
  await markLoaded(page);
  const pidBefore = listenerPid(s.port);
  expect(pidBefore).not.toBe("");

  const routes = join(s.appDir, "src", "serve", "routes.ts");
  const src = readFileSync(routes, "utf8");
  const edited = src.replace(
    "return json({ projects: entries(ctx.projects) });",
    "return json({ projects: entries(ctx.projects), edited: true });",
  );
  expect(edited).not.toBe(src);
  writeFileSync(routes, edited);

  await expect
    .poll(() => s.output(), { timeout: 20000 })
    .toContain("reusing the live server");
  expect(s.output()).toContain(`on port ${s.port}`);
  await expect
    .poll(
      async () => {
        const res = await fetch(`${s.origin}/api/projects`);
        return ((await res.json()) as { edited?: boolean }).edited;
      },
      { timeout: 20000 },
    )
    .toBe(true);
  expect(listenerPid(s.port)).toBe(pidBefore);

  expect(s.werk("add", "after", "--title", "After edit", "--parent", "root").code).toBe(0);
  await expect(leftPane(page).getByText("After edit")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
});

test("14.3 in dev a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
  srv,
}) => {
  const s = await srv({
    appCopy: true,
    events: [...card("root", "Root"), ...card("seats", "We charge per seat", "root")],
  });
  await page.goto(`${s.url}/map/seats`);
  const heading = leftPane(page).getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("We charge per seat");
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await markLoaded(page);

  const entry = join(s.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);

  await expect.poll(() => stillLoaded(page), { timeout: 30000 }).toBe(false);
  await expect(heading).toHaveText("We charge per seat");
  await expect(composer).toHaveValue("draft that must survive");
});
