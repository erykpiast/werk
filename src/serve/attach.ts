/**
 * A start in a folder while a server already runs: the folder goes on that server's list, the project
 * opens in the browser, and this process exits (#werk-projects-one-process).
 */

import { serverLockPath } from "../projects/list-store.ts";
import { liveHolder } from "./lock.ts";
import { openInBrowser } from "./open-browser.ts";
import { tokenOf } from "./page-html.ts";

export type AttachOptions = {
  home: string;
  folder: string;
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  /** How long to wait for a server that has taken the lock and does not listen yet. */
  waitMs?: number;
};

/** The exit code of the attach, or null when no server runs and the caller starts one. */
export async function attachToRunning(
  options: AttachOptions,
): Promise<number | null> {
  const { home, folder, env, out, err } = options;
  const deadline = Date.now() + (options.waitMs ?? 5000);
  let holder = liveHolder(serverLockPath(home));
  while (holder && holder.port === 0 && Date.now() < deadline) {
    await Bun.sleep(50);
    holder = liveHolder(serverLockPath(home));
  }
  if (!holder) return null;
  if (holder.port === 0) {
    err(`werk: the server of pid ${holder.pid} does not listen yet`);
    return 1;
  }
  const origin = `http://127.0.0.1:${holder.port}`;
  try {
    const token = tokenOf(await (await fetch(`${origin}/`)).text());
    if (token === null) throw new Error("the page has no token");
    const res = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { "x-werk-token": token, "content-type": "application/json" },
      body: JSON.stringify({ folder }),
    });
    const body = (await res.json()) as {
      name?: string;
      message?: string;
      locked?: string;
    };
    if (!res.ok || body.name === undefined) {
      err(body.message ?? `werk: the server answered ${res.status}`);
      return 1;
    }
    if (body.locked !== undefined) {
      err(body.locked);
      return 1;
    }
    const url = `${origin}/p/${encodeURIComponent(body.name)}`;
    out(
      `werk: added ${body.name} to the server on port ${holder.port}: ${url}`,
    );
    if (!(await openInBrowser(url, env))) {
      err(`werk: could not open the browser; open ${url}`);
    }
    return 0;
  } catch (error) {
    err(
      `werk: the server on port ${holder.port} (pid ${holder.pid}) did not take the project: ${String(error)}`,
    );
    return 1;
  }
}
