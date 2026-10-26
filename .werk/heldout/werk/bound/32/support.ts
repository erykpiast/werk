import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  startBrowserServer,
  type BrowserServer,
  type ServerOptions,
} from "../e2e/support/server.ts";

export type Ev = Record<string, unknown>;

export const card = (
  id: string,
  parent: string | null,
  status: "open" | "proto" | "decided" = "open",
  title = `Title ${id}`,
): Ev[] => {
  const base: Ev[] = [
    {
      type: "node.proposed",
      id,
      kind: "card",
      title,
      status: status === "decided" ? "open" : status,
      ...(parent ? { parent } : {}),
      why: `why ${id}`,
    },
    { type: "node.accepted", id, actor: "you" },
  ];
  if (status === "decided") {
    base.push(
      { type: "node.edited", id, who: "me", noBasis: "test" },
      { type: "criterion.added", id, form: "revisit" },
      { type: "node.decided", id },
    );
  }
  return base;
};

export const dependsOn = (from: string, to: string): Ev => ({
  type: "edge.added",
  from,
  to,
  link: "depends_on",
  why: `${from} takes ${to}`,
});

export const reopen = (id: string): Ev => ({
  type: "node.reopened",
  id,
  at: "2026-10-10T09:00:00.000Z",
});

/** Starts a server on a project with this log, so the page has a custom map. */
export async function serverWithLog(
  events: Ev[],
  options: ServerOptions = {},
): Promise<BrowserServer> {
  const server = await startBrowserServer(options);
  writeFileSync(
    join(server.dir, ".werk", "log.jsonl"),
    `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
  await server.start();
  return server;
}

export const leftPane = (page: Page) =>
  page.getByRole("region", { name: "Map pane" });

export const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
export const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
