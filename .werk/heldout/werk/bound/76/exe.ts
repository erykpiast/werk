// Builds werk's executable from a copy of the checkout, so the checkout itself gets no dist folder.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CHECKOUT = fileURLToPath(new URL("..", import.meta.url));

export function copyOfCheckout(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-build-")));
  const skip = new Set(["node_modules", ".git", ".werk-heldout", "test-results", "dist", "coverage"]);
  cpSync(CHECKOUT, root, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => src === CHECKOUT || !skip.has(src.slice(CHECKOUT.length).split("/")[0] as string),
  });
  mkdirSync(join(root, "node_modules"));
  for (const e of readdirSync(join(CHECKOUT, "node_modules"))) {
    if (e === ".vite" || e === ".vite-temp" || e === ".werk-installed") continue;
    symlinkSync(join(CHECKOUT, "node_modules", e), join(root, "node_modules", e));
  }
  const later = new Date(Date.now() + 5000);
  writeFileSync(join(root, "node_modules", ".werk-installed"), "");
  utimesSync(join(root, "node_modules", ".werk-installed"), later, later);
  return root;
}

export const platformName = () =>
  `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;

let built: { root: string; exe: string } | undefined;

/** `make build` in a copy; the executable for this platform and the copy's folder. */
export function buildAll(): { root: string; out: string; exe: string; make: { status: number | null; out: string } } {
  if (built === undefined) {
    const root = copyOfCheckout();
    const r = spawnSync("make", ["build"], { cwd: root, encoding: "utf8" });
    built = { root, exe: join(root, "dist", "bin", `werk-${platformName()}`) };
    (built as unknown as { make: unknown }).make = { status: r.status, out: r.stdout + r.stderr };
  }
  return { ...built, out: join(built.root, "dist", "bin"), make: (built as unknown as { make: { status: number | null; out: string } }).make };
}

/** The executable of this platform, copied alone into an empty folder. */
export function aloneExe(): string {
  const { exe } = buildAll();
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-alone-")));
  const target = join(folder, "werk");
  cpSync(exe, target);
  if (!existsSync(target)) throw new Error("copy failed");
  return target;
}
