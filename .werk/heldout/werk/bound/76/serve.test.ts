import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { currentWerkArgv } from "../src/own/running.ts";
import { card, lines, ok, seed, serve, withRoot, type Project } from "./h.ts";

async function readAll(s: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(s).text();
}

function threeCards(): Project {
  const p = withRoot();
  seed(p, [card("one", "Card one", { parent: "root" }), card("two", "Card two", { parent: "root" }), card("three", "Card three", { parent: "root" })]);
  return p;
}

test("13.1 a second server on the same store waits, then refuses, naming pid and port", async () => {
  const p = threeCards();
  const start = () => p.start([...currentWerkArgv(), "serve", "--port", "0"]);
  const a = start();
  const b = start();
  const first = (proc: typeof a) =>
    Promise.race([
      (async () => {
        const r = proc.stdout.getReader();
        let out = "";
        for (;;) {
          const { value, done } = await r.read();
          if (done) return undefined;
          out += new TextDecoder().decode(value);
          const m = /http:\/\/\S+/.exec(out);
          if (m) return m[0];
        }
      })(),
      proc.exited.then(() => undefined),
    ]);
  const [ua, ub] = await Promise.all([first(a), first(b)]);
  const running = [ua, ub].filter((u) => u !== undefined);
  expect(running.length).toBe(1);
  const winner = ua !== undefined ? a : b;
  const loser = ua !== undefined ? b : a;
  const t0 = Date.now();
  const code = await loser.exited;
  const err = await readAll(loser.stderr);
  expect(code).not.toBe(0);
  expect(err).toMatch(/pid \d+/);
  expect(err).toContain(`pid ${winner.pid}`);
  expect(err).toMatch(/port \d+/);
  expect(Date.now() - t0).toBeLessThan(12000);
  const html = await (await fetch(running[0] as string)).text();
  for (const t of ["Card one", "Card two", "Card three"]) expect(html).toContain(t);
});

test("13.2 a killed server leaves a lock; the next start does not wait", async () => {
  const p = withRoot();
  seed(p, [card("one", "Card one", { parent: "root" })]);
  const first = await serve(p);
  first.proc.kill("SIGKILL");
  await first.proc.exited;
  expect(readFileSync(join(p.dir, ".werk", "serve.lock"), "utf8")).toContain("pid");
  const t0 = Date.now();
  const second = await serve(p);
  expect(Date.now() - t0).toBeLessThan(3500);
  const html = await (await second.get("/map")).text();
  expect(html).toContain("Card one");
  expect(html).toContain("Root");
});

test("13.4 a card added while the server was down shows on the first load; bodies only on a card", async () => {
  const p = withRoot();
  await ok(p, "add", "second", "--title", "The second card", "--why", "Because reasons", "--body", "Secret body words here", "--parent", "root");
  const s = await serve(p);
  const home = await (await s.get("/map")).text();
  expect(home).toContain("The second card");
  expect(home).not.toContain("Secret body words here");
  const graph = await (await s.get("/api/graph?shape=1")).text();
  expect(graph).not.toContain("Secret body words here");
  const read = await (await s.get("/api/card/second")).json();
  expect(read.found).toBe(true);
  expect(read.html).toContain("Secret body words here");
  expect(read.html).toContain("Because reasons");
  expect(read.html.toLowerCase()).toContain("open");
  expect(read.html).toContain("Root");
});

function send(url: string, path: string, o: { method?: string; host?: string; token?: string; body?: string } = {}) {
  const { port } = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: o.method ?? "GET",
        headers: { host: o.host ?? `localhost:${port}`, "content-type": "application/json", ...(o.token ? { "x-werk-token": o.token } : {}) },
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => {
          body += c.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(o.body);
  });
}

test("13.5 only the person's own page can write to the map", async () => {
  const p = withRoot();
  await ok(p, "add", "a1", "--title", "Ghost one", "--parent", "root");
  await ok(p, "add", "a2", "--title", "Ghost two", "--parent", "root");
  await ok(p, "add", "a3", "--title", "Ghost three", "--parent", "root");
  const s = await serve(p);
  const good = await send(s.url, "/api/accept", { method: "POST", token: s.token, body: JSON.stringify({ id: "a1" }) });
  expect(good.status).toBe(200);
  expect((await ok(p, "show", "a1")).out.split("\n")[0]).not.toContain("proposed");
  const before = lines(p);
  const noToken = await send(s.url, "/api/accept", { method: "POST", body: JSON.stringify({ id: "a2" }) });
  expect(noToken.status).toBe(403);
  const badHost = await send(s.url, "/api/accept", { method: "POST", token: s.token, host: "evil.example", body: JSON.stringify({ id: "a2" }) });
  expect(badHost.status).toBe(403);
  expect(lines(p)).toEqual(before);
  const read = await send(s.url, "/api/card/a3");
  expect(read.status).toBe(200);
  expect(JSON.parse(read.body).card).toMatchObject({ id: "a3" });
});

test("69.4 a second server on the same project says it waits for the first's pid, then stops with an error naming it", async () => {
  const p = threeCards();
  const first = await serve(p);
  const t0 = Date.now();
  const second = p.start([...currentWerkArgv(), "serve", "--port", "0"]);
  const outP = readAll(second.stdout);
  const errP = readAll(second.stderr);
  const code = await second.exited;
  const took = Date.now() - t0;
  const out = await outP;
  const err = await errP;
  expect(out + err).toMatch(/wait/i);
  expect(out + err).toContain(String(first.proc.pid));
  expect(code).not.toBe(0);
  expect(took).toBeLessThan(8000);
  expect(err).toContain(`pid ${first.proc.pid}`);
  const html = await (await first.get("/map")).text();
  for (const t of ["Card one", "Card two", "Card three"]) expect(html).toContain(t);
});
