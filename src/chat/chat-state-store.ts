/**
 * The files that keep a conversation across a server restart, beside the map log: the session id,
 * and the model, advisor and context fill (#werk-resume, #werk-model-persist).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ModelPick, parsePick } from "./model-pick.ts";

export type SavedSettings = ModelPick & { used: number; window: number };

const sessionFile = (logPath: string) => join(dirname(logPath), "session");
const settingsFile = (logPath: string) =>
  join(dirname(logPath), "chat-model.json");

/** The stored session id, or null when none is stored. */
export function readSessionId(logPath: string): string | null {
  try {
    const id = readFileSync(sessionFile(logPath), "utf8").trim();
    return id === "" ? null : id;
  } catch {
    return null;
  }
}

export function writeSessionId(logPath: string, id: string): void {
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(sessionFile(logPath), `${id}\n`);
}

export function clearSessionId(logPath: string): void {
  rmSync(sessionFile(logPath), { force: true });
}

/** The saved settings. A missing or unreadable file, or one with a broken field, holds none. */
export function readSettings(logPath: string): SavedSettings | null {
  try {
    const data = JSON.parse(readFileSync(settingsFile(logPath), "utf8"));
    const pick = parsePick(data);
    if (pick === null) return null;
    const { used, window } = data;
    if (typeof used !== "number" || typeof window !== "number") return null;
    return { ...pick, used, window };
  } catch {
    return null;
  }
}

export function writeSettings(logPath: string, settings: SavedSettings): void {
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(
    settingsFile(logPath),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
}
