import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test as base, type Page } from "@playwright/test";
import { type BrowserServer, startBrowserServer } from "./server.ts";

const SHOTS = join(
  import.meta.dirname,
  "..",
  "results",
  "screenshots",
);

type Fixtures = {
  /** A started server on a copy of the fixture project. */
  app: BrowserServer;
  /** A started server that runs from a copy of the app, so a spec can edit the client. */
  appCopy: BrowserServer;
  /** Writes a screenshot as evidence. No test compares it (#werk-test-visual-judge). */
  evidence: (page: Page, name: string) => Promise<void>;
};

async function served(options: Parameters<typeof startBrowserServer>[0]) {
  const server = await startBrowserServer(options);
  await server.start();
  return server;
}

export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a fixture needs from this pattern.
  app: async ({}, use) => {
    const server = await served({});
    await use(server);
    await server.dispose();
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a fixture needs from this pattern.
  appCopy: async ({}, use) => {
    const server = await served({ appCopy: true });
    await use(server);
    await server.dispose();
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a fixture needs from this pattern.
  evidence: async ({}, use) => {
    mkdirSync(SHOTS, { recursive: true });
    await use(async (page, name) => {
      await page.screenshot({ path: join(SHOTS, `${name}.png`) });
    });
  },
});

export { expect } from "@playwright/test";
