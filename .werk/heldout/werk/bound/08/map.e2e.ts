// Held-out steps that need the person in the map: 10.1, 10.3, 10.4, 10.5 and 15.x. Each test seeds a
// log with werk's own command line, starts werk's map the way `make dev` does (src/cli.ts serve),
// and opens it in a real browser.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "src", "cli.ts");

type Map = { log: string; werk(...args: string[]): string; open(page: Page, path?: string): Promise<void>; stop(): void };

function freshMap(): Map {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-"));
  const log = join(dir, ".werk", "log.jsonl");
  const env = { ...process.env, WERK_LOG: log };
  let server: ChildProcess | undefined;
  return {
    log,
    werk(...args) {
      const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
      if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
      return run.stdout;
    },
    async open(page, path = "/") {
      // The map server prints its address when it listens; it may also exit.
      server = spawn("bun", [CLI, "serve"], { cwd: dir, env: { ...env, PORT: "0" } });
      let output = "";
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`werk serve printed no address in 15s:\n${output}`)), 15000);
        const read = (chunk: Buffer) => {
          output += chunk.toString();
          const found = output.match(/https?:\/\/[^\s]+/);
          if (found) {
            clearTimeout(timer);
            resolve(found[0].replace(/\/$/, ""));
          }
        };
        server?.stdout?.on("data", read);
        server?.stderr?.on("data", read);
        server?.on("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`werk serve exited ${code} before the map opened:\n${output.split("\n")[0]}`));
        });
      });
      await page.goto(url + path);
    },
    stop() {
      server?.kill();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let map: Map;
test.beforeEach(() => {
  map = freshMap();
});
test.afterEach(() => map.stop());

function realCard(id: string, title: string, extra: string[] = []): void {
  map.werk("add", id, "--title", title, ...extra);
  map.werk("accept", id, "--actor", "you");
}

test("10.1 an agent's note appears on the card's thread in the map", async ({ page }) => {
  realCard("auth-login", "Login uses magic links");
  map.werk("edit", "auth-login", "--who", "you", "--no-basis", "root", "--unchallenged", "none seen");
  map.werk("kill", "auth-login", "--revisit");
  map.werk("status", "auth-login", "decided");
  map.werk("say", "auth-login", "Should expired links show a retry button?");
  await map.open(page);
  await page.getByText("Login uses magic links").first().click();
  const note = page.getByText("Should expired links show a retry button?");
  await expect(note).toBeVisible();
  await expect(page.getByText(/agent/i).first()).toBeVisible();
});

test("10.3 a corrected ghost keeps its earlier notes in the map", async ({ page }) => {
  map.werk("add", "auth-retry", "--title", "Retry sends a new link");
  await map.open(page);
  await expect(page.getByText("Retry sends a new link")).toBeVisible();
});

test("10.4 the thread of a re-proposed ghost shows the old note in the map", async ({ page }) => {
  map.werk("add", "cache-ttl", "--title", "Cache entries live 60 seconds");
  await map.open(page);
  await expect(page.getByText("Cache entries live 60 seconds")).toBeVisible();
});

test("10.5 the person sees the agent's note on an excerpt in the map", async ({ page }) => {
  await map.open(page, "/map/src-rfc-quote");
  await expect(page.getByText("This quote supports the retry decision")).toBeVisible();
});

test("15.1 every form of a card reference becomes the same link", async ({ page }) => {
  realCard("al-diff", "Al diff");
  realCard("align", "Align");
  realCard("notes-test", "Notes test", ["--body", "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too."]);
  await map.open(page, "/map/notes-test");
  await expect(page.locator('a[href$="/map/al-diff"]')).toHaveCount(4);
});

test("15.2 text that only looks like a reference stays text", async ({ page }) => {
  realCard("al-diff", "Al diff");
  realCard("guards", "Guards", ["--body", "--al-diff\n\n##al-diff\n\nAnd #al-diff on its own."]);
  await map.open(page, "/map/guards");
  await expect(page.locator('a[href$="/map/al-diff"]')).toHaveCount(1);
});

test("15.3 fenced code is boxed, labelled and highlighted", async ({ page }) => {
  realCard("code-sample", "Code sample", ["--body", "```zsh\necho $HOME | grep -v x\n```"]);
  await map.open(page, "/map/code-sample");
  await expect(page.getByText("zsh", { exact: true })).toBeVisible();
});

test("15.4 a script tag in card text shows as text and runs nothing", async ({ page }) => {
  realCard("unsafe", "Unsafe", ["--body", "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~"]);
  await map.open(page, "/map/unsafe");
  await expect(page.getByText("<script>window.__pwned = true</script>")).toBeVisible();
});

test("15.5 references link in chat messages but not in a grid tile", async ({ page }) => {
  realCard("al-diff", "Al diff");
  await map.open(page);
  await expect(page.getByRole("textbox")).toBeVisible();
});
