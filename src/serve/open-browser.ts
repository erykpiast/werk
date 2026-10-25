/** Opens an address in the person's browser. WERK_OPEN names another program, so a test opens no window. */
import { platform } from "node:os";

export async function openInBrowser(
  url: string,
  env: Record<string, string | undefined>,
): Promise<boolean> {
  const program =
    env.WERK_OPEN ?? (platform() === "darwin" ? "open" : "xdg-open");
  try {
    const child = Bun.spawn([program, url], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env,
    });
    return (await child.exited) === 0;
  } catch {
    return false;
  }
}
