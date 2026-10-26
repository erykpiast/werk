# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: release.spec.ts >> 49.4 the agent is told to run werk through the executable path
- Location: .werk-heldout/e2e-d/release.spec.ts:108:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Done')
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('Done') with timeout 30000ms
  - waiting for getByText('Done')

```

```yaml
- region "Map pane":
  - button "empty-d ▾"
  - navigation "Breadcrumbs":
    - strong: Home
  - navigation "Views":
    - button "Home"
    - button "Map"
    - button "Board"
  - searchbox "Search the map"
  - paragraph: The map has no cards yet.
- complementary "Chat pane":
  - log "Conversation":
    - article: "Add a card with werk the agent exited: env: bun: No such file or directory Your message was not delivered. Send it again."
  - text: "env: bun: No such file or directory Your message was not delivered. Send it again. idle"
  - combobox "Model":
    - option "Sonnet"
    - option "Opus"
    - option "Sonnet + Opus advisor" [selected]
  - button "Context 0% full"
  - textbox "Message":
    - /placeholder: Message the agent
  - button "main"
  - button "New conversation": +
```

# Test source

```ts
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
  87  |   expect(literalOutput, "start in an empty folder (no git repository)").toContain("serving on");
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
> 125 |     await expect(page.getByText("Done")).toBeVisible({ timeout: 30_000 });
      |                                          ^ Error: expect(locator).toBeVisible() failed
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