import { test } from "bun:test";
import { createProject, runner } from "./helpers.ts";
test("probe", async () => {
  const p = createProject();
  const w = runner(p);
  const o: unknown[] = [];
  o.push(await w("help"));
  o.push(await w("add", "auth", "--title", "Auth"));
  o.push(await w("accept", "auth", "--actor", "you"));
  o.push(await w("add", "login", "--title", "Login", "--parent", "auth"));
  o.push(await w("accept", "login", "--actor", "you"));
  o.push(await w("remove", "auth", "--actor", "you"));
  o.push(await w("remove", "auth"));
  o.push(await w("show", "auth"));
  console.log(JSON.stringify(o, null, 1));
  console.log(await Bun.file(p.logPath).text());
  await p.dispose();
});
