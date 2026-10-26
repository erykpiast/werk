import { test as base } from "@playwright/test";
import { type BrowserServer, startBrowserServer } from "./server.ts";

type Fixtures = { app: BrowserServer; appCopy: BrowserServer };
async function served(options: Parameters<typeof startBrowserServer>[0]) {
  const server = await startBrowserServer(options);
  await server.start();
  return server;
}
export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs this pattern
  app: async ({}, use) => {
    const s = await served({});
    await use(s);
    await s.dispose();
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs this pattern
  appCopy: async ({}, use) => {
    const s = await served({ appCopy: true });
    await use(s);
    await s.dispose();
  },
});
export { expect } from "@playwright/test";
export { startBrowserServer };
