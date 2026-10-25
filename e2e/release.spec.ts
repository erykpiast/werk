import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const REPO = join(import.meta.dirname, "..");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

test("the release build makes four executables with a checksum each, and the one for this machine serves the client from an empty folder", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), "werk-release-"));
  const out = join(root, "out");
  const empty = join(root, "empty");
  mkdirSync(empty);
  let child: ChildProcess | undefined;
  try {
    const built = spawnSync("bun", ["src/release/build.ts", out], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(built.status, built.stderr).toBe(0);

    for (const platform of PLATFORMS) {
      const file = join(out, `werk-${platform}`);
      expect(existsSync(file)).toBe(true);
      const digest = createHash("sha256")
        .update(readFileSync(file))
        .digest("hex");
      expect(readFileSync(`${file}.sha256`, "utf8")).toBe(
        `${digest}  werk-${platform}\n`,
      );
    }

    const here = `${process.platform}-${process.arch}`;
    const exe = join(out, `werk-${here}`);
    // The executable starts from a folder with no source and no packages, with no inherited werk state.
    const env = { PATH: process.env.PATH ?? "", HOME: join(root, "home") };
    mkdirSync(env.HOME);
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: empty, env });

    const help = spawnSync(exe, ["help"], {
      cwd: empty,
      env,
      encoding: "utf8",
    });
    expect(help.status).toBe(0);
    const verbs = readdirSync(join(REPO, "src", "verbs"))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => name.replace(/\.ts$/, ""));
    expect(verbs.length).toBeGreaterThan(10);
    for (const verb of verbs) expect(help.stdout).toContain(` ${verb} `);

    const port = await freePort();
    let output = "";
    child = spawn(exe, ["serve", "--port", String(port)], {
      cwd: empty,
      env: { ...env, WERK_HOME: join(root, "werk-home") },
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk) => {
        output += String(chunk);
      });
    }
    await expect
      .poll(() => output, { timeout: 30_000 })
      .toContain("werk: serving on");
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("#screen")).toBeVisible();
    const script = await page
      .locator("script[type=module]")
      .getAttribute("src");
    const asset = await fetch(`http://127.0.0.1:${port}${script}`);
    expect(asset.status).toBe(200);
  } finally {
    child?.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});
