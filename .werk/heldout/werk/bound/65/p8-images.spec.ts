import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import type { Script } from "../e2e/../src/fake-agent/script.ts";
import { expect, test } from "@playwright/test";
import {
  type BrowserServer,
  startBrowserServer,
} from "../e2e/support/server.ts";

const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});
const init = {
  event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] },
};
const replies = (n: number, first: unknown[] = []) => ({
  roles: {
    chat: {
      replies: Array.from({ length: n }, (_, i) =>
        i === 0 ? [...first, say(`m${i}`, `Answer ${i}`)] : [say(`m${i}`, `Answer ${i}`)],
      ),
    },
  },
}) as Script;

// --- image bytes ---
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
function png(r: number, g: number, b: number): Buffer {
  const w = 8, h = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([r, g, b]).flat())]);
  const raw = Buffer.concat(Array(h).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
// A tiny valid baseline JPEG (1x1 red).
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const padded = (base: Buffer, size: number) =>
  Buffer.concat([base, Buffer.alloc(Math.max(0, size - base.length))]);

type Pic = { mime: string; name: string; b64: string; size: number };
const pic = (buf: Buffer, mime: string, name: string): Pic => ({
  mime,
  name,
  b64: buf.toString("base64"),
  size: buf.length,
});
// Padding is made in the page, so a 25 MB file does not cross the wire as text.
const bigPng = (mb: number, color = 1): Pic => {
  const base = png(color, 0, 0);
  return { mime: "image/png", name: "big.png", b64: base.toString("base64"), size: mb * 1024 * 1024 };
};
const smallPng = (r: number, g = 0, b = 0) => {
  const buf = png(r, g, b);
  return pic(buf, "image/png", `s${r}.png`);
};

async function paste(page: Page, p: Pic) {
  await page.getByRole("textbox", { name: "Message" }).evaluate(
    (el, p) => {
      const base = Uint8Array.from(atob(p.b64), (c) => c.charCodeAt(0));
      const bytes = new Uint8Array(Math.max(p.size, base.length));
      bytes.set(base);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], p.name, { type: p.mime }));
      el.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    p,
  );
}
async function drop(page: Page, p: Pic) {
  await page.locator('[data-slot="composer"]').evaluate(
    (el, p) => {
      const base = Uint8Array.from(atob(p.b64), (c) => c.charCodeAt(0));
      const bytes = new Uint8Array(Math.max(p.size, base.length));
      bytes.set(base);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], p.name, { type: p.mime }));
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    p,
  );
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const chips = (page: Page) => page.locator('[data-slot="image-chip"]');
const messages = (s: BrowserServer) =>
  s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const attachDir = (s: BrowserServer) => join(s.dir, ".werk", "attachments");
const stored = (s: BrowserServer) =>
  existsSync(attachDir(s)) ? readdirSync(attachDir(s)).filter((f) => !f.startsWith(".")) : [];

async function withServer(
  script: Script,
  body: (s: BrowserServer) => Promise<void>,
  prepare?: (s: BrowserServer) => void,
) {
  const server = await startBrowserServer({ script });
  prepare?.(server);
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}
async function open(page: Page, s: BrowserServer) {
  await page.goto(s.url);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
const pathOf = (msg: string, n: number) =>
  new RegExp(`\\[Image #${n}\\] = (\\S+)`).exec(msg)?.[1];

test("24.1 pick a card from the hash menu", async ({ page }) => {
  await withServer(
    replies(1),
    async (s) => {
      await open(page, s);
      const box = composer(page);
      await box.click();
      await box.pressSequentially("Look at #wer");
      const menu = page.getByRole("listbox");
      await expect(menu).toBeVisible();
      const options = menu.getByRole("option");
      await expect(options).toHaveCount(1);
      await expect(options.first()).toContainText("#werk-shots");
      await expect(options.first()).toContainText("Pasted screenshots");
      await box.press("ArrowDown");
      await box.press("ArrowUp");
      await expect(options.first()).toHaveAttribute("aria-selected", "true");
      await box.press("Enter");
      await expect(box).toHaveValue(/^Look at #werk-shots\s?$/);
      await expect(menu).toHaveCount(0);
      await box.fill("");
      await box.pressSequentially("`#wer");
      await expect(page.getByRole("listbox")).toHaveCount(0);
    },
    (s) =>
      appendFileSync(
        join(s.dir, ".werk", "log.jsonl"),
        `${JSON.stringify({ type: "node.proposed", id: "werk-shots", kind: "card", title: "Pasted screenshots", status: "open", why: "People paste screenshots." })}\n${JSON.stringify({ type: "node.accepted", id: "werk-shots", actor: "you" })}\n`,
      ),
  );
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withServer(replies(1), async (s) => {
    await open(page, s);
    const box = composer(page);
    await box.fill("What is wrong here? ");
    await box.press("End");
    await paste(page, smallPng(200));
    await expect(box).toHaveValue(/What is wrong here\? \[Image #1\]/);
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toContainText("[Image #1]");
    await expect(chips(page).first().locator("img")).toBeVisible();
    await expect(chips(page).first().locator("img")).toHaveJSProperty("complete", true);
    await box.press("Enter");
    await expect(chat(page).getByText("Answer 0")).toBeVisible();
    const msg = messages(s)[0]!;
    const p = pathOf(msg, 1);
    expect(p, msg).toBeTruthy();
    expect(p).toContain(`${join(".werk", "attachments")}/`);
    expect(existsSync(p!)).toBe(true);
    expect(msg).toMatch(/Open each image above with Read/);
    const status = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: s.dir, encoding: "utf8" });
    expect(status).not.toContain("attachments");
    expect(stored(s)).toHaveLength(1);
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withServer(replies(1), async (s) => {
    await open(page, s);
    await drop(page, bigPng(25));
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first().locator('[data-slot="image-reason"]')).toContainText(/20 MB/);
    await composer(page).pressSequentially(" why");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Answer 0")).toBeVisible();
    const msg = messages(s)[0]!;
    expect(msg).not.toContain("attachments");
    expect(msg).not.toMatch(/\[Image #1\] =/);
    expect(stored(s)).toHaveLength(0);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withServer(replies(1), async (s) => {
    await open(page, s);
    await paste(page, smallPng(200));
    await expect(chips(page).first().locator("img")).toBeVisible();
    await paste(page, pic(JPEG, "image/jpeg", "b.jpg"));
    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).nth(1).locator("img")).toBeVisible();
    await expect(composer(page)).toHaveValue(/\[Image #1\].*\[Image #2\]/s);
    const jpegSrc = await chips(page).nth(1).locator("img").getAttribute("src");
    await page.getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(chips(page)).toHaveCount(1);
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    await expect(chips(page).first()).toContainText("[Image #1]");
    expect(await chips(page).first().locator("img").getAttribute("src")).toBe(jpegSrc);
    await composer(page).pressSequentially(" hi");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Answer 0")).toBeVisible();
    const msg = messages(s)[0]!;
    const p = pathOf(msg, 1)!;
    expect(p).toMatch(/\.jpg$/);
    expect(msg).not.toMatch(/\[Image #2\] =/);
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  await withServer(replies(1, [init]), async (s) => {
    await open(page, s);
    await composer(page).fill("hi");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Answer 0")).toBeVisible();
    const base = `${s.origin}/api/projects/${encodeURIComponent(basename(s.dir))}/image`;
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    expect((await fetch(base)).status).toBe(404);
    const up = await fetch(`${base}?name=${encodeURIComponent("../log.jsonl")}`);
    expect(up.status).toBe(404);
    const up2 = await fetch(`${base}?name=${encodeURIComponent("../../.werk/log.jsonl")}`);
    expect(up2.status).toBe(404);
    expect((await up2.text()).includes("node.proposed")).toBe(false);
    await composer(page).click();
    await composer(page).pressSequentially("/");
    await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["/review", "/recall"]);
  });
});

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withServer(replies(1), async (s) => {
    await open(page, s);
    // hold the upload so the spinner can be seen
    await page.route("**/image", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await paste(page, smallPng(200));
    await expect(chips(page).first().locator('[data-slot="spinner"]')).toBeVisible();
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    await expect(chips(page).first().locator("img")).toBeVisible();
    await expect(chips(page).first()).toContainText("[Image #1]");
    await composer(page).pressSequentially("Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Answer 0")).toBeVisible();
    await expect(chat(page).getByRole("img", { name: "[Image #1]" })).toBeVisible();
    const msg = messages(s)[0]!;
    const p = pathOf(msg, 1)!;
    expect(p).toContain(`${join(".werk", "attachments")}/`);
    expect(msg).toMatch(/Open each image above with Read/);
    const bytes = png(200, 0, 0).toString("base64");
    expect(msg).not.toContain(bytes);
    expect(msg).not.toContain(bytes.slice(0, 40));
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withServer(replies(1), async (s) => {
    await open(page, s);
    await paste(page, { ...smallPng(200), size: 2 * 1024 * 1024 });
    await expect(chips(page).first().locator("img")).toBeVisible();
    await paste(page, bigPng(25, 3));
    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).first()).toContainText("[Image #1]");
    await expect(chips(page).nth(1).locator('[data-slot="image-reason"]')).toContainText(/larger than 20 MB/);
    await page.getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    await composer(page).pressSequentially("Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Answer 0")).toBeVisible();
    const msg = messages(s)[0]!;
    expect(pathOf(msg, 1)).toBeTruthy();
    expect(msg).not.toMatch(/\[Image #2\]/);
    expect(stored(s)).toHaveLength(1);
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withServer(replies(1), async (s) => {
    await open(page, s);
    await paste(page, smallPng(200));
    await expect(chips(page).first().locator("img")).toBeVisible();
    await paste(page, smallPng(10, 200, 10));
    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).nth(1).locator("img")).toBeVisible();
    const secondSrc = await chips(page).nth(1).locator("img").getAttribute("src");
    await expect(composer(page)).toHaveValue(/\[Image #1\].*\[Image #2\]/s);
    await page.getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toContainText("[Image #1]");
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    const v = await composer(page).inputValue();
    expect(v.split("[Image #1]").length - 1).toBe(1);
    await composer(page).pressSequentially(" go");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Answer 0")).toBeVisible();
    const msg = messages(s)[0]!;
    const p = pathOf(msg, 1)!;
    expect(secondSrc).toContain(encodeURIComponent(basename(p)));
    expect(msg).not.toMatch(/\[Image #2\] =/);
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withServer(replies(1), async (s) => {
    await open(page, s);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/image", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await gate;
      await route.continue();
    });
    await paste(page, smallPng(200));
    await expect(chips(page).first().locator('[data-slot="spinner"]')).toBeVisible();
    await composer(page).pressSequentially("What is this?");
    await composer(page).press("Enter");
    await page.waitForTimeout(800);
    expect(messages(s)).toHaveLength(0);
    release();
    await expect(chips(page).first().locator("img").or(page.getByText("Answer 0"))).toBeVisible();
    await expect(chat(page).getByText("Answer 0")).toBeVisible();
    const msg = messages(s)[0]!;
    expect(pathOf(msg, 1)).toContain(`${join(".werk", "attachments")}/`);
  });
});

test("25.5 a nameless or climbing image request answers 404 and the server stays up", async ({ page }) => {
  await withServer(replies(2), async (s) => {
    await open(page, s);
    const base = `${s.origin}/api/projects/${encodeURIComponent(basename(s.dir))}/image`;
    await paste(page, smallPng(200));
    await expect(chips(page).first().locator("img")).toBeVisible();
    await composer(page).pressSequentially("one");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Answer 0")).toBeVisible();
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("../../log.jsonl")}`)).status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("../log.jsonl")}`)).status).toBe(404);
    await paste(page, smallPng(5, 5, 200));
    await expect(chips(page).first().locator("img")).toBeVisible();
    await expect(chips(page).first().locator("img")).toHaveJSProperty("complete", true);
    await composer(page).pressSequentially("two");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Answer 1")).toBeVisible();
  });
});
