import { test as base } from "@playwright/test";
import { type BrowserServer, startBrowserServer } from "./server.ts";

type Fixtures = { app: BrowserServer; appCopy: BrowserServer };

async function served(options: Parameters<typeof startBrowserServer>[0]) {
  const server = await startBrowserServer(options);
  await server.start();
  return server;
}

export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixtures from this pattern.
  app: async ({}, use) => {
    const server = await served({});
    await use(server);
    await server.dispose();
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixtures from this pattern.
  appCopy: async ({}, use) => {
    const server = await served({ appCopy: true });
    await use(server);
    await server.dispose();
  },
});

export { expect } from "@playwright/test";
