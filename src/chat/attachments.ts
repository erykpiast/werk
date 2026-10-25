/**
 * The attachments folder of a project: stores a pasted image, and finds a stored one by its name.
 * The folder holds its own ignore rule, so it stays outside version control without an edit to
 * the project's files (#werk-shots, #werk-chat-image-inline).
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  checkImage,
  type ImageCheck,
  imageFileName,
  isStoredName,
} from "./image-rules.ts";

/** The folder beside the project's log. */
export const attachmentsOf = (logPath: string) =>
  join(dirname(logPath), "attachments");

export type Stored =
  | { ok: true; name: string }
  | Extract<ImageCheck, { ok: false }>;

/** Checks an upload, and writes it to the folder when it passes. Nothing is written for a refusal. */
export function storeImage(logPath: string, bytes: Uint8Array): Stored {
  const checked = checkImage(bytes);
  if (!checked.ok) return checked;
  const dir = attachmentsOf(logPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "*\n");
  const name = imageFileName(
    checked.type,
    new Date(),
    randomBytes(4).toString("hex"),
  );
  writeFileSync(join(dir, name), bytes);
  return { ok: true, name };
}

/** The absolute path of a stored image, or null for a name that is no file in the folder. */
export function findImage(logPath: string, name: string): string | null {
  if (!isStoredName(name)) return null;
  const path = join(attachmentsOf(logPath), name);
  try {
    return statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
}
