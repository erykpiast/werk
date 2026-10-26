import { expect, test } from "bun:test";
import { currentWerkArgv } from "../src/own/running.ts";
import { card, freshProject, type Project, seed } from "./lib.ts";
import { withRoot } from "./lib.ts";

function serve(p: Project, env: Record<string, string> = {}) {
  const proc = p.start([...currentWerkArgv(), "serve", "--port", "0"], { env });
  const out = new Response(proc.stdout).text();
  const err = new Response(proc.stderr).text();
  return { proc, out, err };
}
async function addr(p: Project, s: ReturnType<typeof serve>): Promise<string> {
  // first line of stdout names the address
  const reader = s.proc.stdout;
  void reader;
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const lock = JSON.parse(await Bun.file(`${p.dir}/.werk/serve.lock`).text());
      if (typeof lock.port === "number" && lock.pid === s.proc.pid) return `http://127.0.0.1:${lock.port}`;
    } catch {}
    if (Date.now() > deadline) throw new Error("no server");
    await Bun.sleep(50);
  }
}

test("dump map html", async () => {
  const p = withRoot();
  card(p, "c1", { title: "Card one", body: "SECRET BODY TEXT" });
  const s = serve(p);
  const url = await addr(p, s);
  const html = await (await fetch(`${url}/map`)).text();
  console.log(html.slice(0, 3000));
  for (const path of ["/api/graph", "/api/graph?shape=1", "/api/card/c1"]) {
    const r = await fetch(url + path);
    console.log(path, r.status, (await r.text()).slice(0, 800));
  }
});
