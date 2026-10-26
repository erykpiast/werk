// Held-out steps 15.1 to 15.5: card text rendered in the map and the chat pane.
// Each step seeds a fresh project with werk add, then the person opens the map with werk serve.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const CLI = new URL("../../src/cli.ts", import.meta.url).pathname;
const BUN = process.env.BUN_BIN ?? "bun";

function project(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-")));
  mkdirSync(join(dir, ".werk"));
  writeFileSync(join(dir, ".werk", "log.jsonl"), "");
  return dir;
}

function werk(dir: string, args: string[]): void {
  const run = spawnSync(BUN, [CLI, ...args], { cwd: dir, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
}

/** The person opens the map: werk serve, as make dev starts it. Resolves with the first URL it prints. */
function openMap(dir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(BUN, [CLI, "serve"], { cwd: dir });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => {
      out += d;
      const url = out.match(/https?:\/\/\S+/);
      if (url) resolve(url[0]);
    });
    proc.stderr.on("data", (d) => {
      err += d;
    });
    proc.on("exit", (code) => reject(new Error(`the map did not open: werk serve exited ${code}: ${err.split("\n")[0]}`)));
    setTimeout(() => reject(new Error("the map did not open: werk serve printed no address in 10 s")), 10000);
  });
}

let dir = "";
test.beforeEach(() => {
  dir = project();
});
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("15.1 every form of a card reference in a card body becomes the same link", async ({ page }) => {
  werk(dir, ["add", "al-diff", "--title", "Every change is a diff"]);
  werk(dir, ["add", "align", "--title", "Align"]);
  werk(dir, ["add", "notes-test", "--title", "Notes test", "--body", "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too."]);
  const url = await openMap(dir);
  await page.goto(`${url.replace(/\/$/, "")}/map/notes-test`);
  const body = page.getByText("See", { exact: false }).first();
  await expect(body.locator("a")).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  await body.locator("a").nth(1).click();
  await expect(page).toHaveURL(/\/map\/al-diff$/);
});

test("15.2 text that only looks like a reference stays text", async ({ page }) => {
  werk(dir, ["add", "al-diff", "--title", "Every change is a diff"]);
  const body = ["--al-diff", "", "##al-diff", "", "&al-diff", "", "a code span holding `node src/cli.ts show #al-diff`", "", "see #no-such-card", "", "visit https://example.com/page#al-diff", "", "# al-diff", "", "#al-diff"].join("\n");
  werk(dir, ["add", "guards", "--title", "Guards", "--body", body]);
  const url = await openMap(dir);
  await page.goto(`${url.replace(/\/$/, "")}/map/guards`);
  await expect(page.locator('a[href="/map/al-diff"]')).toHaveCount(1);
});

test("15.3 fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page }) => {
  const body = ["```zsh", "echo $HOME | grep -v x", "```", "```TypeScript", "const n: number = 1", "```", "```cobol", "DISPLAY 'HELLO'.", "```", "```", `${"x".repeat(400)} #al-diff`, "```"].join("\n");
  werk(dir, ["add", "code-sample", "--title", "Code sample", "--body", body]);
  const url = await openMap(dir);
  await page.goto(`${url.replace(/\/$/, "")}/map/code-sample`);
  await expect(page.getByText("zsh", { exact: true })).toBeVisible();
});

test("15.4 card text with a script tag shows the tag as text and runs nothing", async ({ page }) => {
  werk(dir, ["add", "unsafe", "--title", "Unsafe", "--body", "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~"]);
  const url = await openMap(dir);
  await page.goto(`${url.replace(/\/$/, "")}/map/unsafe`);
  await expect(page.getByText("<script>window.__pwned = true</script>")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
});

test("15.5 references link in chat messages but not in a grid tile summary", async ({ page }) => {
  werk(dir, ["add", "al-diff", "--title", "Every change is a diff"]);
  werk(dir, ["add", "old-idea", "--title", "Old idea"]);
  werk(dir, ["discard", "old-idea"]);
  werk(dir, ["add", "tile-card", "--title", "Depends on #al-diff"]);
  const url = await openMap(dir);
  await page.goto(url);
  await page.getByRole("textbox").fill("Compare #al-diff with #old-idea and show code");
  await page.keyboard.press("Enter");
  await expect(page.locator('a[href="/map/al-diff"]').first()).toBeVisible();
});
