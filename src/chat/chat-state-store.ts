/**
 * The files that keep a conversation across a server restart, beside the map log: the session id,
 * and the model, advisor and context fill (#werk-resume, #werk-model-persist).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ModelPick, parsePick } from "./model-pick.ts";

export type SavedSettings = ModelPick & { used: number; window: number };

/** The main conversation keeps the plain file names. Another conversation adds its name to them. */
const sessionFile = (logPath: string, name?: string) =>
  join(dirname(logPath), name ? `session-${name}` : "session");
const settingsFile = (logPath: string, name?: string) =>
  join(dirname(logPath), name ? `chat-model-${name}.json` : "chat-model.json");

/** The stored session id, or null when none is stored. */
export function readSessionId(logPath: string, name?: string): string | null {
  try {
    const id = readFileSync(sessionFile(logPath, name), "utf8").trim();
    return id === "" ? null : id;
  } catch {
    return null;
  }
}

export function writeSessionId(
  logPath: string,
  id: string,
  name?: string,
): void {
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(sessionFile(logPath, name), `${id}\n`);
}

export function clearSessionId(logPath: string, name?: string): void {
  rmSync(sessionFile(logPath, name), { force: true });
}

/** The saved settings. A missing or unreadable file, or one with a broken field, holds none. */
export function readSettings(
  logPath: string,
  name?: string,
): SavedSettings | null {
  try {
    const data = JSON.parse(readFileSync(settingsFile(logPath, name), "utf8"));
    const pick = parsePick(data);
    if (pick === null) return null;
    const { used, window } = data;
    if (typeof used !== "number" || typeof window !== "number") return null;
    return { ...pick, used, window };
  } catch {
    return null;
  }
}

export function writeSettings(
  logPath: string,
  settings: SavedSettings,
  name?: string,
): void {
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(
    settingsFile(logPath, name),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
}
