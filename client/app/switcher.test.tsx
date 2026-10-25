import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SwitcherRow } from "../lib/switcher";
import { Switcher } from "./switcher";

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

const rows: SwitcherRow[] = [
  {
    name: "werk",
    folder: "~/werk",
    busy: true,
    missing: false,
    removable: false,
  },
  {
    name: "checkout",
    folder: "~/checkout",
    busy: false,
    missing: false,
    removable: true,
  },
  { name: "api", folder: "~/api", busy: false, missing: true, removable: true },
];

async function render() {
  const calls: string[] = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <Switcher
        current="werk"
        rows={rows}
        running={() => []}
        onOpen={(n) => calls.push(`open ${n}`)}
        onRemove={(n, c) => calls.push(`remove ${n} ${c}`)}
        onAdd={() => calls.push("add")}
      />,
    ),
  );
  await act(async () =>
    host
      ?.querySelector<HTMLButtonElement>("[data-slot=switcher-button]")
      ?.click(),
  );
  return { el: host, calls };
}

const click = (el: Element | null | undefined) =>
  act(async () => (el as HTMLElement).click());

test("the menu marks a busy and a missing project, and the dev entry has no ×", async () => {
  const { el } = await render();
  const items = [...el.querySelectorAll("[data-slot=switcher-row]")];
  expect(items[0]?.getAttribute("data-busy")).toBe("true");
  expect(items[2]?.getAttribute("data-missing")).toBe("true");
  expect(items[2]?.textContent).toContain("(missing)");
  expect(el.querySelectorAll("[data-slot=switcher-remove]").length).toBe(2);
  expect(items[0]?.querySelector("[data-slot=switcher-remove]")).toBeNull();
  expect(el.textContent).toContain("+ Add project…");
});

test("a click opens another project, and a missing project opens nothing", async () => {
  const { el, calls } = await render();
  const items = [...el.querySelectorAll("[data-slot=switcher-row]")];
  await click(items[2]?.querySelector("button"));
  expect(calls).toEqual([]);
  await click(items[1]?.querySelector("button"));
  expect(calls).toEqual(["open checkout"]);
});

test("× removes a project that runs nothing, and Add project… asks to add", async () => {
  const { el, calls } = await render();
  await click(el.querySelectorAll("[data-slot=switcher-remove]")[0]);
  expect(calls).toEqual(["remove checkout false"]);
  await act(async () =>
    el.querySelector<HTMLButtonElement>("[data-slot=switcher-button]")?.click(),
  );
  const add = [...el.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Add project"),
  );
  await click(add);
  expect(calls).toEqual(["remove checkout false", "add"]);
});
