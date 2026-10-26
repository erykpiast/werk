import { expect, test } from "bun:test";
import { setDefaultTimeout } from "bun:test";
import { makeProject, serve, until, urlOf, werk } from "./e-util.ts";

setDefaultTimeout(30000);
const cards: [string, string, string?][] = [["root", "Root"], ["a", "Card A", "root"], ["b", "Card B", "root"]];

test("13.1 + 69.4 second server on same store waits then refuses naming pid and port", async () => {
  const dir = makeProject(cards);
  const s1 = serve(dir);
  const s2 = serve(dir);
  // exactly one runs
  const winner = await Promise.race([
    until(() => (urlOf(s1) ? s1 : undefined)),
    until(() => (urlOf(s2) ? s2 : undefined)),
  ]);
  const loser = winner === s1 ? s2 : s1;
  const t0 = Date.now();
  const code = await loser.exited;
  const waited = Date.now() - t0;
  expect(code).not.toBe(0);
  expect(urlOf(loser)).toBeUndefined();
  expect(loser.err()).toContain(`pid ${winner.proc.pid}`);
  const port = new URL(urlOf(winner) as string).port;
  expect(loser.err()).toContain(`port ${port}`);
  expect(waited).toBeLessThan(8000);
  const html = await (await fetch(`${urlOf(winner)}/map`)).text();
  const graph = await (await fetch(`${urlOf(winner)}/api/home`)).text();
  expect(html.length + graph.length).toBeGreaterThan(0);
  const g = JSON.stringify(await (await fetch(`${urlOf(winner)}/api/card/root`)).json());
  for (const t of ["Card A", "Card B", "Root"]) expect(g).toContain(t);
  winner.proc.kill("SIGTERM");
  await winner.exited;
});

test("69.4 second server prints that it waits for the pid, then errors within ~5s", async () => {
  const dir = makeProject(cards);
  const s1 = serve(dir);
  const url = await until(() => urlOf(s1));
  const t0 = Date.now();
  const s2 = serve(dir);
  const code = await s2.exited;
  const dt = Date.now() - t0;
  expect(code).not.toBe(0);
  expect(s2.out() + s2.err()).toMatch(/wait/i);
  expect(s2.err()).toContain(`pid ${s1.proc.pid}`);
  expect(dt).toBeLessThan(8000);
  const g = JSON.stringify(await (await fetch(`${url}/api/card/root`)).json());
  for (const t of ["Card A", "Card B"]) expect(g).toContain(t);
  s1.proc.kill("SIGTERM");
  await s1.exited;
});

test("13.2 new server starts after a killed server left its lock", async () => {
  const dir = makeProject([["root", "Root"], ["a", "Card A", "root"]]);
  const s1 = serve(dir);
  await until(() => urlOf(s1));
  s1.proc.kill("SIGKILL");
  await s1.exited;
  const t0 = Date.now();
  const s2 = serve(dir);
  const url = await until(() => urlOf(s2));
  expect(Date.now() - t0).toBeLessThan(4000);
  const g = JSON.stringify(await (await fetch(`${url}/api/card/root`)).json());
  expect(g).toContain("Root");
  expect(g).toContain("Card A");
  s2.proc.kill("SIGTERM");
  await s2.exited;
  void werk;
});
