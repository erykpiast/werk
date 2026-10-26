import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);
const real = (w: Pick<Werk, "seed">, id: string, f: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...f });
const style = (p: Page, sel: string) =>
  p.locator(sel).first().evaluate((e) => {
    const s = getComputedStyle(e);
    return { border: s.borderTopStyle, borderColor: s.borderTopColor, bg: s.backgroundColor };
  });
const chroma = (c: string) => {
  const m = /oklch\(([\d.]+) ([\d.]+)/.exec(c);
  if (m) return Number(m[2]);
  const r = /rgba?\((\d+), (\d+), (\d+)/.exec(c);
  if (r) return (Math.max(+r[1], +r[2], +r[3]) - Math.min(+r[1], +r[2], +r[3])) / 255;
  return -1;
};

test("70.1 ghost under its proposed parent drawn grey and dashed; real card normal", async ({ page: p }) => {
  const w = await project(undefined, (d) => real(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const tile = p.locator('a[data-tile="refunds"]');
  await expect(tile).toContainText("Refunds");
  const g = await tile.evaluate((e) => { const s = getComputedStyle(e); return { border: s.borderTopStyle, bc: s.borderTopColor, bg: s.backgroundColor }; });
  expect(g.border).toBe("dashed");
  // grey: neither the border colour nor the fill carries a hue
  expect(chroma(g.bc)).toBeLessThan(0.03);
  expect(chroma(g.bg)).toBeLessThan(0.03);
  const r = await style(p, 'article[data-card="payments"]');
  expect(r.border).not.toBe("dashed");
});

test("70.2 ✓ on a ghost makes it real, one accept event by the person", async ({ page: p }) => {
  const w = await project(undefined, (d) => real(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const fs = await import("node:fs");
  const log = `${w.dir}/.werk/log.jsonl`;
  const n = () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
  const before = n().length;
  await p.goto(`${w.url}/map/refunds`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.getByRole("button", { name: "Accept" })).toHaveCount(0);
  const after = n();
  expect(after.length).toBe(before + 1);
  const ev = JSON.parse(after.at(-1) as string);
  expect(ev.type).toBe("change.accepted");
  expect(ev.payload.id).toBe("refunds");
  expect(ev.actor).toBe("you");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('a[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.3 accept of ghost child under ghost parent makes both real", async ({ page: p }) => {
  const w = await project(undefined, (d) => real(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('a[data-tile="partial"]')).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('a[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("70.4 accept takes only the branch, no accept-all control", async ({ page: p }) => {
  const w = await project(undefined, (d) => real(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "Never refund", "--why_not", "Angry customers");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk("add", "refunds-src", "--kind", "source", "--title", "Survey", "--finding", "They want refunds");
  w.werk("link", "refunds", "refunds-src", "--type", "supported_by");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
  await p.goto(`${w.url}/map/refunds`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  expect(w.werk("show", "refunds:opt0")).not.toContain("proposed");
  expect(w.werk("show", "refunds-src")).not.toContain("proposed");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('a[data-tile="chargebacks"]')).toHaveAttribute("data-proposed", "true");
  const g = await p.locator('a[data-tile="chargebacks"]').evaluate((e) => getComputedStyle(e).borderTopStyle);
  expect(g).toBe("dashed");
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
});

test("70.5 second window sees the accept", async ({ browser }) => {
  const w = await project(undefined, (d) => real(d, "payments", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  await a.goto(`${w.url}/map/refunds`);
  await b.goto(`${w.url}/map/refunds`);
  await expect(b.locator("article")).toHaveAttribute("data-proposed", "true");
  await a.getByRole("button", { name: "Accept" }).click();
  await expect(a.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(b.locator("article")).toHaveAttribute("data-proposed", "false");
  await ctx.close();
});
