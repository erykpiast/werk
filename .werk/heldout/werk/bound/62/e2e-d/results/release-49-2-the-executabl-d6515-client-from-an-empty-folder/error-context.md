# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: release.spec.ts >> 49.2 the executable serves the client from an empty folder
- Location: .werk-heldout/e2e-d/release.spec.ts:59:1

# Error details

```
Error: start in an empty folder (no git repository)

expect(received).toContain(expected) // indexOf

Expected substring: "serving on"
Received string:    "werk: /private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-ho-rel-fJee3T/empty-a has no git repository. git is required: run \"git init\" there.
"
```

# Test source

```ts
  1   | import { type ChildProcess, spawn, spawnSync } from "node:child_process";
  2   | import { createHash } from "node:crypto";
  3   | import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
  4   | import { tmpdir } from "node:os";
  5   | import { join, resolve } from "node:path";
  6   | import { expect, test } from "@playwright/test";
  7   | 
  8   | const CHECKOUT = resolve(import.meta.dirname, "..", "..");
  9   | const FAKE = join(CHECKOUT, "fake");
  10  | const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
  11  | const here = `${process.platform}-${process.arch}`;
  12  | 
  13  | let root: string;
  14  | let clone: string;
  15  | let out: string;
  16  | 
  17  | test.beforeAll(() => {
  18  |   root = mkdtempSync(join(tmpdir(), "werk-ho-rel-"));
  19  |   clone = join(root, "clone");
  20  |   const c = spawnSync("git", ["clone", "-q", CHECKOUT, clone], { encoding: "utf8" });
  21  |   expect(c.status, c.stderr).toBe(0);
  22  |   const i = spawnSync("bun", ["install", "--frozen-lockfile"], { cwd: clone, encoding: "utf8" });
  23  |   expect(i.status, i.stderr).toBe(0);
  24  |   out = join(root, "out");
  25  |   const built = spawnSync("bun", ["src/release/build.ts", out], { cwd: clone, encoding: "utf8" });
  26  |   expect(built.status, built.stderr).toBe(0);
  27  |   mkdirSync(join(root, "home"), { recursive: true });
  28  | });
  29  | test.afterAll(() => rmSync(root, { recursive: true, force: true }));
  30  | 
  31  | const freePort = async () => {
  32  |   const { createServer } = await import("node:net");
  33  |   return new Promise<number>((res) => {
  34  |     const s = createServer();
  35  |     s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
  36  |   });
  37  | };
  38  | 
  39  | function emptyFolderWithExe(name: string, git: boolean) {
  40  |   const dir = join(root, name);
  41  |   mkdirSync(dir);
  42  |   cpSync(join(out, `werk-${here}`), join(dir, "werk"));
  43  |   if (git) spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  44  |   return dir;
  45  | }
  46  | const exeEnv = (extra: Record<string, string> = {}) => ({ PATH: `/usr/bin:/bin`, HOME: join(root, "home"), WERK_HOME: join(root, "werk-home"), WERK_OPEN: "true", ...extra });
  47  | 
  48  | test("49.1 the release build makes four executables with matching checksums", () => {
  49  |   const names = readdirSync(out).filter((f) => f.startsWith("werk-") && !f.endsWith(".sha256")).sort();
  50  |   expect(names).toEqual(PLATFORMS.map((p) => `werk-${p}`).sort());
  51  |   for (const p of PLATFORMS) {
  52  |     const file = join(out, `werk-${p}`);
  53  |     const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  54  |     expect(readFileSync(`${file}.sha256`, "utf8")).toContain(digest);
  55  |     expect(readFileSync(`${file}.sha256`, "utf8")).toContain(`werk-${p}`);
  56  |   }
  57  | });
  58  | 
  59  | test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  60  |   const dir = emptyFolderWithExe("empty-a", false);
  61  |   const literal = spawnSync(join(dir, "werk"), ["serve", "--port", "0"], { cwd: dir, env: exeEnv(), encoding: "utf8", timeout: 10_000 });
  62  |   const literalOutput = `${literal.stdout}${literal.stderr}`;
  63  |   // Record what the literal step does: start in an empty folder.
  64  |   test.info().annotations.push({ type: "literal-start", description: `exit ${literal.status}: ${literalOutput.trim()}` });
  65  |   const gitDir = emptyFolderWithExe("empty-b", true);
  66  |   const before = readdirSync(gitDir).sort();
  67  |   const port = await freePort();
  68  |   let log = "";
  69  |   const child: ChildProcess = spawn(join(gitDir, "werk"), ["serve", "--port", String(port)], { cwd: gitDir, env: exeEnv() });
  70  |   for (const s of [child.stdout, child.stderr]) s?.on("data", (d) => { log += String(d); });
  71  |   try {
  72  |     await expect.poll(() => log, { timeout: 30_000 }).toContain("serving on");
  73  |     await page.goto(`http://127.0.0.1:${port}/`);
  74  |     await expect(page.locator("#screen")).toBeVisible();
  75  |     const missing: string[] = [];
  76  |     page.on("response", (r) => { if (r.status() >= 400) missing.push(r.url()); });
  77  |     await page.reload();
  78  |     await expect(page.locator("#screen")).toBeVisible();
  79  |     expect(missing).toEqual([]);
  80  |     const after = readdirSync(gitDir).sort();
  81  |     const added = after.filter((n) => !before.includes(n));
  82  |     test.info().annotations.push({ type: "added-next-to-exe", description: added.join(",") });
  83  |   } finally {
  84  |     child.kill("SIGTERM");
  85  |   }
  86  |   // The literal step: werk starts and prints the address in an empty folder.
> 87  |   expect(literalOutput, "start in an empty folder (no git repository)").toContain("serving on");
      |                                                                         ^ Error: start in an empty folder (no git repository)
  88  | });
  89  | 
  90  | const verbsOf = (text: string) => text.split("\n").slice(2).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  91  | 
  92  | test("49.3 the executable's help lists every command, and a command works", () => {
  93  |   const dir = emptyFolderWithExe("empty-c", false);
  94  |   const exe = spawnSync(join(dir, "werk"), ["help"], { cwd: dir, env: exeEnv(), encoding: "utf8" });
  95  |   expect(exe.status).toBe(0);
  96  |   const checkout = spawnSync("bun", ["src/cli.ts", "help"], { cwd: clone, encoding: "utf8" });
  97  |   const a = verbsOf(exe.stdout);
  98  |   expect(a.length).toBeGreaterThan(10);
  99  |   expect(a).toEqual(verbsOf(checkout.stdout));
  100 |   const add = spawnSync(join(dir, "werk"), ["add", "first", "--title", "First card"], { cwd: dir, env: exeEnv(), encoding: "utf8" });
  101 |   expect(add.status, add.stderr).toBe(0);
  102 |   const show = spawnSync(join(dir, "werk"), ["show", "first"], { cwd: dir, env: exeEnv(), encoding: "utf8" });
  103 |   expect(show.status, show.stderr).toBe(0);
  104 |   expect(show.stdout + show.stderr).not.toMatch(/no such file|ENOENT|not found|missing/i);
  105 |   expect(show.stdout).toContain("First card");
  106 | });
  107 | 
  108 | test("49.4 the agent is told to run werk through the executable path", async ({ page }) => {
  109 |   const dir = emptyFolderWithExe("empty-d", true);
  110 |   const scriptPath = join(root, "script.json");
  111 |   writeFileSync(scriptPath, JSON.stringify({ roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Done" }] } } }]] } } }));
  112 |   const port = await freePort();
  113 |   let log = "";
  114 |   const child = spawn(join(dir, "werk"), ["serve", "--port", String(port)], {
  115 |     cwd: dir,
  116 |     env: exeEnv({ PATH: `${FAKE}:/usr/bin:/bin`, WERK_FAKE_SCRIPT: scriptPath }),
  117 |   });
  118 |   for (const s of [child.stdout, child.stderr]) s?.on("data", (d) => { log += String(d); });
  119 |   try {
  120 |     await expect.poll(() => log, { timeout: 30_000 }).toContain("serving on");
  121 |     await page.goto(`http://127.0.0.1:${port}/`);
  122 |     const composer = page.getByRole("textbox", { name: "Message" });
  123 |     await composer.fill("Add a card with werk");
  124 |     await composer.press("Enter");
  125 |     await expect(page.getByText("Done")).toBeVisible({ timeout: 30_000 });
  126 |     const rec = readFileSync(`${scriptPath}.launches.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  127 |     const launch = rec.find((r) => r.kind === "launch" && r.role === "chat");
  128 |     const args: string[] = launch.args;
  129 |     const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
  130 |     expect(prompt).toContain(join(dir, "werk").replace(/^\/private/, ""));
  131 |     expect(prompt).not.toMatch(/bun\b[^\n]*cli\.ts/);
  132 |     expect(prompt).not.toContain("src/cli.ts");
  133 |   } finally {
  134 |     child.kill("SIGTERM");
  135 |   }
  136 | });
  137 | 
```