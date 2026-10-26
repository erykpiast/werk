import { expect, type Page, test } from "@playwright/test";
import { devServer } from "./browser.ts";

type S = Awaited<ReturnType<typeof devServer>>;
const add = (s: S, id: string, title: string, parent?: string, status?: string) => {
  const args = ["add", id, "--title", title];
  if (parent) args.push("--parent", parent);
  if (status) args.push("--status", status);
  expect(s.werk(...args).code).toBe(0);
  expect(s.werk("accept", id, "--actor", "you").code).toBe(0);
};
const header = (page: Page) => page.locator("[data-slot=header-row-1]");

test("17.1 breadcrumbs of a deep card", async ({ page }) => {
  const s = await devServer();
  try {
    add(s, "l1", "Level one", "root");
    add(s, "l2", "Level two", "l1");
    add(s, "l3", "Level three", "l2");
    add(s, "l4", "Level four", "l3");
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto(`${s.url}/map/l4`);
    await expect(page.getByRole("heading", { level: 1, name: "Level four" })).toBeVisible();
    const head = header(page);
    await expect(head).toContainText("›");
    await expect(head).toContainText("…");
    await expect(head.getByText("Level three")).toBeVisible();
    await expect(head.locator("b, strong").getByText("Level four")).toBeVisible();
    await head.hover();
    await expect(page.getByRole("tooltip")).toContainText("Home");
    await head.getByText("Level three").click();
    await expect(page.getByRole("heading", { level: 1, name: "Level three" })).toBeVisible();
    await expect(head.locator("b, strong").getByText("Level three")).toBeVisible();
  } finally {
    await s.dispose();
  }
});

test("17.2 header counts follow the open card", async ({ page }) => {
  const s = await devServer();
  try {
    add(s, "o1", "Open child", "root");
    add(s, "p1", "Proto child", "root", "proto");
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const head = header(page);
    await expect(head.locator('[title*="open" i]')).toBeVisible();
    await expect(head.locator('[title*="proto" i]')).toBeVisible();
    await expect(head.locator('[title*="decided" i]')).toHaveCount(0);
  } finally {
    await s.dispose();
  }
});

test("17.3 search box finds a card by id", async ({ page }) => {
  const s = await devServer();
  try {
    add(s, "werk", "Werk", "root");
    add(s, "werk-two", "Werk two", "root");
    add(s, "my-werk", "My werk", "root");
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const box = page.getByRole("searchbox").or(page.getByRole("combobox")).or(page.getByPlaceholder(/search/i));
    await box.first().fill("#werk", { timeout: 3000 });
    await expect(page.getByRole("option")).toHaveCount(3);
  } finally {
    await s.dispose();
  }
});

test("17.4 Map and Board tabs", async ({ page }) => {
  const s = await devServer();
  try {
    add(s, "c1", "Card one", "root");
    await page.goto(`${s.url}/map/c1`);
    await expect(page.getByRole("heading", { level: 1, name: "Card one" })).toBeVisible();
    await page.getByRole("link", { name: "Board" }).or(page.getByRole("tab", { name: "Board" })).first().click({ timeout: 3000 });
    await expect(page).toHaveURL(/\/board$/);
  } finally {
    await s.dispose();
  }
});

test("17.5 home shows requirements and build rules side by side", async ({ page }) => {
  const s = await devServer();
  try {
    add(s, "how", "How we build", "root");
    add(s, "how1", "A build rule", "how");
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "How we build" })).toBeVisible({ timeout: 3000 });
  } finally {
    await s.dispose();
  }
});
