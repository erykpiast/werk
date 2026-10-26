import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { FAKE_DIR } from "../src/test-env/env.ts";
import { logPathFor, readRecords } from "../src/fake-agent/launch-log.ts";

const BUN_DIR = dirname(spawnSync("sh", ["-c", "command -v bun"], { encoding: "utf8" }).stdout.trim());
const TMP = realpathSync(tmpdir());
const state = JSON.parse(readFileSync(join(TMP, "werk-heldout-release.json"), "utf8")) as { out: string };
const exe = join(state.out, `werk-${process.platform}-${process.arch}`);

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

async function until(check: () => boolean, what: string, ms = 30000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** A project folder holding nothing but the executable's git repository. The binder reads "empty" as "no werk files". */
function emptyProject() {
  const root = mkdtempSync(join(TMP, "werk-heldout-exe-"));
  const folder = join(root, "empty");
  const home = join(root, "home");
  spawnSync("mkdir", ["-p", folder, home]);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: folder });
  return { root, folder, home };
}

test("49.2 the executable serves the client from an empty folder", async ({ page }) => {
  const { root, folder, home } = emptyProject();
  let child: ChildProcess | undefined;
  try {
    const before = readdirSync(folder).sort();
    const port = await freePort();
    // No bun on the search path, and nothing of werk's source in the folder.
    const env = { PATH: "/usr/bin:/bin", HOME: home, WERK_HOME: join(home, "werk"), WERK_OPEN: "true" };
    let output = "";
    child = spawn(exe, ["serve", "--port", String(port)], { cwd: folder, env });
    for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
    await until(() => output.includes(`127.0.0.1:${port}`) || output.includes(`localhost:${port}`) || child?.exitCode != null, "the address");
    expect(child.exitCode, output).toBeNull();
    const address = /(http:\/\/[^\s]+)/.exec(output)?.[1] ?? `http://127.0.0.1:${port}`;
    const failed: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(address);
    await expect(page.locator("#screen")).toBeVisible();
    await expect(page.getByRole("region", { name: "Map pane" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
    const after = readdirSync(folder).sort();
    const added = after.filter((n) => !before.includes(n));
    expect(added.filter((n) => !n.startsWith(".werk"))).toEqual([]);
    expect(after).not.toContain("client");
    expect(after).not.toContain("dist");
    expect(after).not.toContain("src");
  } finally {
    child?.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});

test("49.4 the agent and the commands name the executable that is running", async ({ page }) => {
  const { root, folder, home } = emptyProject();
  let child: ChildProcess | undefined;
  try {
    const script = join(root, "script.json");
    writeFileSync(
      script,
      JSON.stringify({
        roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }]] } },
      }),
    );
    const port = await freePort();
    const env = {
      PATH: `${FAKE_DIR}:${BUN_DIR}:/usr/bin:/bin`, // the fake agent script itself is a bun script
      HOME: home,
      WERK_HOME: join(home, "werk"),
      WERK_OPEN: "true",
      WERK_FAKE_SCRIPT: script,
    };
    let output = "";
    child = spawn(exe, ["serve", "--port", String(port)], { cwd: folder, env });
    for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
    await until(() => output.includes(String(port)) || child?.exitCode != null, "the address");
    expect(child.exitCode, output).toBeNull();
    await page.goto(`http://127.0.0.1:${port}/p/empty`);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("Run a werk command");
    await composer.press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("ok")).toBeVisible();
    const launch = readRecords(logPathFor(script)).find((r) => r.kind === "launch" && r.role === "chat");
    expect(launch).toBeDefined();
    const args = (launch as { args: string[] }).args;
    const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
    expect(prompt).toContain(`"${exe}"`);
    const commandLine = prompt.split("\n").find((l) => l.includes(`"${exe}"`)) ?? "";
    expect(commandLine).not.toMatch(/\bbun\b|\.ts\b/i);
    // The agent runs that line. It must work as written.
    const ran = spawnSync("sh", ["-c", `${`"${exe}"`} add one --title One`], { cwd: folder, env, encoding: "utf8" });
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout).toContain("proposed");
  } finally {
    child?.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});
