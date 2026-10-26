import { expect, test } from "bun:test";
import { join } from "node:path";
import { card, type Held, held } from "./helpers.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

type Started = { proc: ReturnType<Held["start"]>; url: Promise<string>; ended: Promise<{ code: number; err: string }> };

function serve(h: Held, env: Record<string, string> = {}): Started {
  const proc = h.start([process.execPath, CLI, "serve", "--port", "0"], { env });
  let out = "";
  let err = "";
  const url = new Promise<string>((resolve) => {
    void (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of proc.stdout) {
        out += decoder.decode(chunk);
        const found = /http:\/\/\S+/.exec(out);
        if (found !== null) return resolve(found[0]);
      }
      // A start that ends with no URL never settles here; its end settles the race instead.
    })();
  });
  const ended = (async () => {
    err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    return { code, err };
  })();
  return { proc, url, ended };
}

function threeCards(h: Held): void {
  card(h, "root", "Shop root");
  card(h, "cart", "Cart keeps items", { parent: "root" });
  card(h, "pay", "Pay with card", { parent: "root" });
}

test("13.1 a second server on the same store refuses while the first one runs", async () => {
  const h = held();
  threeCards(h);
  const began = performance.now();
  const a = serve(h);
  const b = serve(h);
  const outcome = (s: Started) =>
    Promise.race([
      s.url.then((url) => ({ kind: "url" as const, url })),
      s.ended.then((e) => ({ kind: "ended" as const, ...e })),
    ]);
  const [ra, rb] = await Promise.all([outcome(a), outcome(b)]);
  const results = [ra, rb];
  const running = results.filter((r) => r.kind === "url");
  const stopped = results.filter((r) => r.kind === "ended");
  expect(running.length).toBe(1);
  expect(stopped.length).toBe(1);
  const winner = (ra.kind === "url" ? a : b) as Started;
  const url = (running[0] as { url: string }).url;
  const port = new URL(url).port;
  const loser = stopped[0] as { code: number; err: string };
  expect(loser.code).not.toBe(0);
  // The losing start waited for the lock (the default wait is 5 seconds) before it stopped.
  expect(performance.now() - began).toBeGreaterThan(4000);
  expect(loser.err).toContain(`pid ${winner.proc.pid}`);
  expect(loser.err).toContain(port);

  const page = await (await fetch(url)).text();
  for (const title of ["Shop root", "Cart keeps items", "Pay with card"]) expect(page).toContain(title);
  winner.proc.kill("SIGTERM");
  await winner.ended;
}, 60000);

test("13.2 a new server starts after a killed server left its lock behind", async () => {
  const h = held();
  card(h, "root", "Shop root");
  card(h, "cart", "Cart keeps items", { parent: "root" });
  const first = serve(h);
  await first.url;
  first.proc.kill("SIGKILL");
  await first.ended;

  const began = performance.now();
  // A long lock wait: a start that waited for the old server would take a minute.
  const second = serve(h, { WERK_LOCK_WAIT_MS: "60000" });
  const url = await Promise.race([
    second.url,
    second.ended.then((e) => {
      throw new Error(`serve ended ${e.code}: ${e.err}`);
    }),
  ]);
  expect(performance.now() - began).toBeLessThan(30000);
  const page = await (await fetch(url)).text();
  expect(page).toContain("Shop root");
  expect(page).toContain("Cart keeps items");
  second.proc.kill("SIGTERM");
  await second.ended;
}, 90000);
