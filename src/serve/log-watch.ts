/** Watches the log's directory and calls back each time the log grows (#werk-write-changed, #werk-write-watch-start). */
import { type FSWatcher, statSync, watch } from "node:fs";
import { basename, dirname } from "node:path";

export type LogWatch = { close(): void };

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * The directory is watched, not the file, so a log that does not exist yet is seen when it appears.
 * Other files in the directory, such as the fold times, are not the log and send nothing.
 * The watch starts before this returns, so a caller that listens afterwards misses no write.
 */
export function watchLog(logPath: string, onGrow: () => void): LogWatch {
  const name = basename(logPath);
  let size = sizeOf(logPath);
  const watcher: FSWatcher = watch(dirname(logPath), (_event, file) => {
    if (file !== null && String(file) !== name) return;
    const now = sizeOf(logPath);
    if (now <= size) {
      size = now;
      return;
    }
    size = now;
    onGrow();
  });
  return { close: () => watcher.close() };
}
