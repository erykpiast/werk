import { expect, test } from "@playwright/test";
import { leftPane, withServer } from "./support.ts";

const crumbs = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Breadcrumbs" });

test("17.1 deep card: breadcrumbs on one line, overlay on hover, click parent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await withServer(
    {},
    async (s) => {
      await page.goto(s.url);
      const pane = leftPane(page);
      await expect(pane.getByRole("heading", { level: 1 })).toBeVisible();
      const w = (await pane.boundingBox())?.width ?? 0;
      expect(w).toBeLessThan(700);
      // Home view: open the deep card from the map by following tiles down.
      await page
        .getByRole("navigation", { name: "Views" })
        .getByRole("button", { name: "Home" })
        .click()
        .catch(() => {});
      for (const t of ["Level a", "Level b", "Level c", "Level d"]) {
        await pane.locator("a.tile", { hasText: t }).first().click();
      }
      const line = crumbs(page).locator("[data-slot=crumb-line]");
      await expect(line.locator("[data-slot=crumb-current]")).toHaveText(
        "Level d",
      );
      const text = (await line.innerText()).replace(/\s+/g, " ").trim();
      expect(text).toBe("… › Level c › Level d");
      await expect(line.locator("button")).toHaveText(["Level c"]);
      expect((await line.boundingBox())?.height).toBeLessThan(40);
      await line.hover({ force: true });
      const overlay = crumbs(page).locator("[data-slot=crumb-overlay]");
      await expect(overlay).toBeVisible();
      const full = (await overlay.innerText()).replace(/\s+/g, " ").trim();
      expect(full).toBe(
        "Home › We build software with agents › Level a › Level b › Level c › Level d",
      );
      await overlay.getByRole("button", { name: "Level c" }).click();
      await expect(
        pane.getByRole("heading", { level: 1, name: "Level c" }),
      ).toBeVisible();
      await expect(
        crumbs(page).locator(
          "[data-slot=crumb-line] [data-slot=crumb-current]",
        ),
      ).toHaveText("Level c");
    },
    (s) => {
      s.card("a", "Level a", "root");
      s.card("b", "Level b", "a");
      s.card("c", "Level c", "b");
      s.card("d", "Level d", "c");
    },
  );
});

test("17.2 header counts follow the open card", async ({ page }) => {
  await withServer(
    {},
    async (s) => {
      await page.goto(`${s.url}/map/root`);
      const counts = page.locator("[data-slot=counts] [data-slot=count]");
      await expect(counts.first()).toBeVisible();
      const read = async () => {
        const out: Record<string, { n: number; title: string }> = {};
        for (const el of await counts.all()) {
          out[(await el.getAttribute("data-kind")) as string] = {
            n: Number(await el.innerText()),
            title: (await el.getAttribute("title")) ?? "",
          };
        }
        return out;
      };
      const c = await read();
      expect(c.total?.n).toBe(7);
      expect(c.open?.n).toBe(2);
      expect(c.proto?.n).toBe(2);
      expect(c.decided?.n).toBe(3);
      expect(c.open.n + c.proto.n + c.decided.n).toBe(c.total.n);
      expect(c.stale?.n).toBe(1);
      expect(c.postponed).toBeUndefined();
      expect(c.open.title).toContain("open");
      expect(c.proto.title).toContain("proto");
      expect(c.decided.title).toContain("decided");
      expect(c.stale.title).toContain("stale");
      await leftPane(page)
        .locator("a.tile", { hasText: "Open one" })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { level: 1, name: "Open one" }),
      ).toBeVisible();
      await expect.poll(async () => (await read()).total?.n).toBe(2);
      const c2 = await read();
      expect(c2.open?.n).toBe(1);
      expect(c2.proto?.n).toBe(1);
      expect(c2.decided).toBeUndefined();
    },
    (s) => {
      s.decide("root");
      s.card("o", "Open one", "root");
      s.ok(
        "add",
        "o1",
        "--title",
        "Proto under open",
        "--parent",
        "o",
        "--status",
        "proto",
      );
      s.ok("accept", "o1", "--actor", "you");
      s.card("p", "Proto one", "root", ["--status", "proto"]);
      s.card("d", "Decided one", "root");
      s.decide("d");
      s.card("base", "Base card", "root");
      s.decide("base");
      s.card("s", "Stale one", "root");
      s.decide("s");
      s.ok("link", "s", "base", "--type", "depends_on", "--why", "needs base");
      s.ok("reopen", "base");
    },
  );
});

test("17.3 search by id with # ranks, caps at twelve, marks stale, keyboard and Enter", async ({
  page,
}) => {
  await withServer(
    {},
    async (s) => {
      await page.goto(s.url);
      const box = page.getByRole("searchbox", { name: "Search the map" });
      await box.fill("#werk");
      const rows = page
        .getByRole("list", { name: "Search results" })
        .locator("li");
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBe(12);
      const ids = await rows.locator("code").allInnerTexts();
      expect(ids[0]).toBe("werk");
      const isPrefix = ids.map((i) => i.startsWith("werk"));
      const firstContains = isPrefix.indexOf(false);
      expect(firstContains).toBeGreaterThan(0);
      expect(isPrefix.slice(firstContains).every((x) => !x)).toBe(true);
      for (let i = 0; i < 12; i++) {
        const row = rows.nth(i);
        await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
        await expect(row.locator("[data-slot=result-title]")).not.toHaveText(
          "",
        );
      }
      const stale = rows.filter({
        has: page.locator("code", { hasText: /^werk-3$/ }),
      });
      await expect(stale.locator("[data-slot=dot]")).toHaveAttribute(
        "data-color",
        "stale",
      );
      await expect(rows.nth(0)).toHaveAttribute("aria-current", "true");
      await box.press("ArrowDown");
      await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
      await box.press("ArrowUp");
      await expect(rows.nth(0)).toHaveAttribute("aria-current", "true");
      await box.press("Enter");
      await expect(page).toHaveURL(/\/map\/werk$/);
      await expect(
        page
          .getByRole("navigation", { name: "Breadcrumbs" })
          .locator("[data-slot=crumb-line] [data-slot=crumb-current]"),
      ).toHaveText("Werk root card");
      await expect(box).toHaveValue("");
    },
    (s) => {
      s.decide("root");
      s.card("werk", "Werk root card", "root");
      for (let i = 1; i <= 8; i++)
        s.card(`werk-${i}`, `Werk part ${i}`, "root");
      for (let i = 1; i <= 6; i++) s.card(`x-werk-${i}`, `Other ${i}`, "root");
      s.ok("edit", "werk-3", "--who", "me", "--no-basis", "x");
      s.ok("kill", "werk-3", "--revisit");
      s.ok("status", "werk-3", "decided");
      s.ok("reopen", "root");
    },
  );
});
