import { expect, test } from "bun:test";
import { createHandler, TOKEN_HEADER } from "./handler.ts";

const req = (init: RequestInit & { host?: string; token?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("host", init.host ?? "localhost:4000");
  if (init.token) headers.set(TOKEN_HEADER, init.token);
  return new Request("http://localhost:4000/x", { ...init, headers });
};

test("a changing request without the token is refused before the route runs", async () => {
  let ran = 0;
  const handler = createHandler("t", () => {
    ran += 1;
    return new Response("ok");
  });
  expect((await handler(req({ method: "POST" }))).status).toBe(403);
  expect((await handler(req({ method: "POST", token: "bad" }))).status).toBe(
    403,
  );
  expect((await handler(req({ method: "POST", token: "t" }))).status).toBe(200);
  expect(ran).toBe(1);
});

test("a request with a non-loopback Host is refused, read-only or not", async () => {
  const handler = createHandler("t", () => new Response("ok"));
  expect((await handler(req({ host: "evil.com" }))).status).toBe(403);
  expect(
    (await handler(req({ method: "POST", token: "t", host: "evil.com" })))
      .status,
  ).toBe(403);
});

test("a route that throws answers 500 and the next request succeeds", async () => {
  const logged: string[] = [];
  const handler = createHandler(
    "t",
    (r) => {
      if (new URL(r.url).searchParams.has("boom")) throw new Error("boom");
      return new Response("ok");
    },
    (text) => logged.push(text),
  );
  const bad = await handler(
    new Request("http://localhost/x?boom=1", {
      headers: { host: "localhost" },
    }),
  );
  expect(bad.status).toBe(500);
  expect(logged.join()).toContain("boom");
  expect((await handler(req())).status).toBe(200);
});

test("an async route that rejects answers 500", async () => {
  const handler = createHandler(
    "t",
    async () => {
      throw new Error("later");
    },
    () => {},
  );
  expect((await handler(req())).status).toBe(500);
});

test("the token never appears in a refusal or a log line", async () => {
  const logged: string[] = [];
  const handler = createHandler(
    "SECRET-TOKEN",
    () => {
      throw new Error("x");
    },
    (text) => logged.push(text),
  );
  const refused = await handler(req({ method: "POST" }));
  expect(await refused.text()).not.toContain("SECRET-TOKEN");
  await handler(req({ method: "POST", token: "SECRET-TOKEN" }));
  expect(logged.join()).not.toContain("SECRET-TOKEN");
});
