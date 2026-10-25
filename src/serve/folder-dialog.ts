/**
 * The operating system's folder dialog, opened by the server. A browser cannot give the server the full
 * path of a folder, and the server runs on the machine of the person, so the dialog appears in front of
 * them (#werk-projects-add).
 */
import { platform } from "node:os";

export type Chosen = { folder: string } | { cancelled: true };

const MAC_DIALOG = [
  "osascript",
  "-e",
  'POSIX path of (choose folder with prompt "Add a project to werk")',
];

/** WERK_FOLDER_DIALOG names another program that prints the chosen folder, so a test needs no window. */
export async function chooseFolder(
  env: Record<string, string | undefined>,
): Promise<Chosen> {
  const command = env.WERK_FOLDER_DIALOG
    ? [env.WERK_FOLDER_DIALOG]
    : platform() === "darwin"
      ? MAC_DIALOG
      : null;
  if (command === null) {
    throw new Error(
      "the folder dialog needs macOS; send a folder path instead",
    );
  }
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", env });
  const [out, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  const folder = out.trim().replace(/(.)\/$/, "$1");
  return code === 0 && folder !== "" ? { folder } : { cancelled: true };
}
