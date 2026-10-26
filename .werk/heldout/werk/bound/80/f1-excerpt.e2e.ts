import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

test("06.2 accepted excerpt stops being a ghost; link live; card view shows it as evidence", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "billing", kind: "card", title: "We bill per seat", parent: "root", status: "decided", who: "me" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(w.werk("show", "billing:ex0")).toContain("proposed");

  await p.goto(`${w.url}/map/billing:ex0`);
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
  expect(w.werk("show", "billing:ex0")).not.toContain("proposed");
  const log = w.werk("show", "billing");
  expect(log).not.toContain("held");

  await p.goto(`${w.url}/map/billing`);
  await expect(p.getByText("seats are the unit").first()).toBeVisible();
  await expect(p.locator('[data-pending="true"]')).toHaveCount(0);
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
});
