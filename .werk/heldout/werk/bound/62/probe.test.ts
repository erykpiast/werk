import { test, expect } from "bun:test";
import { createProject, werkIn, writeLog, decidedCard } from "./helpers.ts";
test("probe", async () => {
  const p = createProject();
  try {
    writeLog(p, [...decidedCard("auth", "Auth")]);
    const w = werkIn(p);
    console.log(await w("show", "auth"));
    console.log(await w("show"));
    console.log(p.events().length);
  } finally { await p.dispose(); }
});
