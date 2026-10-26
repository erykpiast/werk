import { test as base } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { type Server, startServer } from "./server.ts";

type Fixtures = {
  app: Server;
  appCopy: Server;
  withScript: (script: Script) => Promise<Server>;
};

export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixtures from this pattern.
  app: async ({}, use) => {
    const s = await startServer();
    await s.start();
    await use(s);
    await s.dispose();
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixtures from this pattern.
  appCopy: async ({}, use) => {
    const s = await startServer({ appCopy: true });
    await s.start();
    await use(s);
    await s.dispose();
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixtures from this pattern.
  withScript: async ({}, use) => {
    const made: Server[] = [];
    await use(async (script) => {
      const s = await startServer({ script });
      await s.start();
      made.push(s);
      return s;
    });
    for (const s of made) await s.dispose();
  },
});

export { expect } from "@playwright/test";
