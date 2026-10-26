import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const say = (speaker: string, text: string, kind = "spoken") => ({ speaker, at: "t", session: "sess1", kind, text });

async function withSession(lines: object[]): Promise<Werk> {
  const w = await project();
  w.seed("node.added", { id: "werk-excerpt", kind: "card", title: "An excerpt cites a transcript", parent: "root" });
  w.seed("node.decided", { id: "werk-excerpt" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  writeFileSync(join(w.dir, ".werk", "chats", "sess.jsonl"), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  return w;
}
const pointer = (p: Page, name: string) => p.locator(`[data-field="pointer"] [data-pointer="${name}"] dd`);
const said = (p: Page) => p.locator('[data-section="say"] [data-link="supported_by"]');

test("67.1 a quote found once becomes a ghost excerpt on the citing card", async ({ page: p }) => {
  const text = "Every quote in the imported map was written from memory";
  const w = await withSession([say("assistant", "hello"), say("user", text)]);
  const out = w.werk("quote", "werk-excerpt", "sess", "written from memory");
  expect(out).toContain("proposed");
  const start = text.indexOf("written from memory");
  await p.goto(`${w.url}/map/werk-excerpt:ex0`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(pointer(p, "session")).toHaveText("sess1");
  await expect(pointer(p, "message")).toHaveText("1");
  await expect(pointer(p, "speaker")).toHaveText("user");
  await expect(pointer(p, "span")).toHaveText(`${start}..${start + "written from memory".length}`);
  await p.goto(`${w.url}/map/werk-excerpt`);
  await expect(said(p)).toHaveCount(1);
  await expect(said(p)).toContainText("written from memory");
});

test("67.2 the excerpt lets the person find the quote again", async ({ page: p }) => {
  const msg = "The tool never guesses; it fails instead.";
  const w = await withSession([say("user", "hi"), say("assistant", msg)]);
  w.werk("quote", "werk-excerpt", "sess", "never guesses");
  await p.goto(`${w.url}/map/werk-excerpt:ex0`);
  const speaker = await pointer(p, "speaker").innerText();
  const message = Number(await pointer(p, "message").innerText());
  const [s, e] = (await pointer(p, "span").innerText()).split("..").map(Number) as [number, number];
  const lines = [say("user", "hi"), say("assistant", msg)];
  const found = lines[message] as { text: string; speaker: string };
  expect(found.text.slice(s, e)).toBe("never guesses");
  expect(found.speaker).toBe("assistant");
  expect(speaker).toBe("assistant");
});

test("67.5 a ghost excerpt is accepted like every ghost", async ({ page: p }) => {
  const w = await withSession([say("user", "seats are the unit we bill")]);
  w.werk("quote", "werk-excerpt", "sess", "seats are the unit");
  await p.goto(`${w.url}/map/werk-excerpt:ex0`);
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/werk-excerpt`);
  await expect(said(p)).toHaveCount(1);
  await expect(said(p)).toContainText("seats are the unit");
  await expect(said(p)).toHaveAttribute("data-pending", "false");
});
