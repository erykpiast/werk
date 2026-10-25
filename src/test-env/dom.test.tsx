import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

/** The runtime's own functions are native code; the DOM's copies are written in JavaScript. */
const isNative = (value: unknown) =>
  Function.prototype.toString.call(value).includes("[native code]");

test("a component test renders into the shared DOM and unmounts what it rendered", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<button type="button">Press</button>);
  });
  expect(host.querySelector("button")?.textContent).toBe("Press");
  await act(async () => {
    root.unmount();
  });
  host.remove();
  expect(document.body.children).toHaveLength(0);
});

test("a server test in the same worker calls the runtime network function", async () => {
  expect(isNative(fetch)).toBe(true);
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("from the server"),
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(await res.text()).toBe("from the server");
  } finally {
    await server.stop(true);
  }
});

test("the timers and streams in use are the runtime's own", () => {
  for (const global of [setTimeout, setInterval, ReadableStream, Response]) {
    expect(isNative(global)).toBe(true);
  }
  expect(document.createElement("div").tagName).toBe("DIV");
});
