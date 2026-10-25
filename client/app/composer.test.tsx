import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Composer } from "./composer";

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  sessionStorage.clear();
});

async function render(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(node));
  return host;
}

test("the composer restores a stashed draft once", async () => {
  sessionStorage.setItem("werk.composer.draft", "kept");
  const el = await render(<Composer />);
  expect(el.querySelector("textarea")?.value).toBe("kept");
  expect(sessionStorage.getItem("werk.composer.draft")).toBeNull();
});

const PNG = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });

function pasteOf(textarea: HTMLTextAreaElement, files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files } });
  textarea.dispatchEvent(event);
}

function fakeSink() {
  const pending: ((r: { name: string } | { error: string }) => void)[] = [];
  return {
    pending,
    sink: {
      upload: () =>
        new Promise<{ name: string } | { error: string }>((done) => {
          pending.push(done);
        }),
      imageUrl: (name: string) => `/img?name=${name}`,
    },
  };
}

const chips = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('[data-slot="image-chip"]'));

test("a pasted image shows a spinner, then its thumbnail, with the token in the text", async () => {
  const { pending, sink } = fakeSink();
  const el = await render(<Composer images={sink} />);
  const box = el.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => pasteOf(box, [PNG]));
  expect(box.value).toBe("[Image #1]");
  expect(el.querySelector('[data-slot="spinner"]')).not.toBeNull();
  expect(el.querySelector("img")).toBeNull();
  await act(async () => pending[0]?.({ name: "a.png" }));
  expect(el.querySelector('[data-slot="spinner"]')).toBeNull();
  expect(el.querySelector("img")?.getAttribute("src")).toBe("/img?name=a.png");
  expect(chips(el)[0]?.textContent).toContain("[Image #1]");
});

test("a refused image shows its reason on the chip and is not sent", async () => {
  const { pending, sink } = fakeSink();
  const sent: [string, string[]][] = [];
  const el = await render(
    <Composer images={sink} onSend={(t, i) => sent.push([t, i])} />,
  );
  const box = el.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => pasteOf(box, [PNG]));
  await act(async () =>
    pending[0]?.({ error: "the image is larger than 20 MB" }),
  );
  expect(el.querySelector('[data-slot="image-reason"]')?.textContent).toBe(
    "the image is larger than 20 MB",
  );
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    set?.call(box, "[Image #1] why");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    box.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(sent).toEqual([["why", []]]);
});

test("removing chip 1 of two renumbers the other to 1", async () => {
  const { pending, sink } = fakeSink();
  const el = await render(<Composer images={sink} />);
  const box = el.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => pasteOf(box, [PNG, PNG]));
  await act(async () => {
    pending[0]?.({ name: "a.png" });
    pending[1]?.({ name: "b.png" });
  });
  expect(box.value).toBe("[Image #1][Image #2]");
  const remove = el.querySelector('button[aria-label="Remove [Image #1]"]');
  await act(async () => (remove as HTMLButtonElement).click());
  expect(box.value).toBe("[Image #1]");
  expect(chips(el)).toHaveLength(1);
  expect(chips(el)[0]?.textContent).toContain("[Image #1]");
  expect(el.querySelector("img")?.getAttribute("src")).toBe("/img?name=b.png");
});

test("Enter waits while an upload runs, then sends the stored name", async () => {
  const { pending, sink } = fakeSink();
  const sent: [string, string[]][] = [];
  const el = await render(
    <Composer images={sink} onSend={(t, i) => sent.push([t, i])} />,
  );
  const box = el.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => pasteOf(box, [PNG]));
  await act(async () =>
    box.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(sent).toEqual([]);
  await act(async () => pending[0]?.({ name: "a.png" }));
  expect(sent).toEqual([["[Image #1]", ["a.png"]]]);
  expect(box.value).toBe("");
  expect(chips(el)).toHaveLength(0);
});
