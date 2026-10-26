import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";
import type { Script } from "../../src/fake-agent/script.ts";

const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});

const REPLY: Script = {
  roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Again")]] } },
};

async function withChat(
  script: Script,
  body: (server: BrowserServer) => Promise<void>,
  prepare?: (server: BrowserServer) => void,
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

const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });
const composerOf = (page: Page) =>
  page.getByRole("textbox", { name: "Message" });
const chipsOf = (page: Page) =>
  page.getByRole("list", { name: "Attached images" });
const attachments = (server: BrowserServer) =>
  join(server.dir, ".werk", "attachments");

type Kind = "png" | "jpeg" | number;

/** Builds a File in the page. A number is a PNG padded to that many bytes. */
const FILE_JS = `
async (kind) => {
  if (typeof kind === "number") {
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const data = new Uint8Array(kind);
    data.set(png);
    return new File([data], "big.png", { type: "image/png" });
  }
  const canvas = document.createElement("canvas");
  canvas.width = 8; canvas.height = 8;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = kind === "jpeg" ? "#00f" : "#f00";
  ctx.fillRect(0, 0, 8, 8);
  const type = kind === "jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise((r) => canvas.toBlob(r, type));
  return new File([blob], kind === "jpeg" ? "s.jpg" : "s.png", { type });
}`;

async function paste(page: Page, kind: Kind) {
  await composerOf(page).focus();
  await page.evaluate(
    async ({ src, kind }) => {
      const make = (0, eval)(src);
      const file = await make(kind);
      const transfer = new DataTransfer();
      transfer.items.add(file);
      document.querySelector("textarea")?.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { src: FILE_JS, kind },
  );
}

async function drop(page: Page, kind: Kind) {
  await page.evaluate(
    async ({ src, kind }) => {
      const make = (0, eval)(src);
      const file = await make(kind);
      const transfer = new DataTransfer();
      transfer.items.add(file);
      document.querySelector('[data-slot="composer"]')?.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { src: FILE_JS, kind },
  );
}

const thumbLoaded = (chip: ReturnType<Page["locator"]>) =>
  expect
    .poll(() =>
      chip
        .getByRole("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);

function addCard(server: BrowserServer) {
  appendFileSync(
    join(server.dir, ".werk", "log.jsonl"),
    `${JSON.stringify({ type: "node.proposed", id: "werk-shots", kind: "card", title: "Pasted screenshots", status: "open", parent: "root" })}\n${JSON.stringify({ type: "node.accepted", id: "werk-shots", actor: "you" })}\n`,
  );
}

test("24.1 a hash menu lists matching cards, Enter inserts the id, a backtick blocks the menu", async ({
  page,
}) => {
  await withChat(
    REPLY,
    async (server) => {
      await page.goto(server.url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const composer = composerOf(page);
      await composer.pressSequentially("Look at #wer");
      const menu = page.getByRole("listbox");
      await expect(menu).toBeVisible();
      const option = menu.getByRole("option");
      await expect(option).toHaveCount(1);
      await expect(option).toContainText("#werk-shots");
      await expect(option).toContainText("Pasted screenshots");
      const m = await menu.boundingBox();
      const c = await composer.boundingBox();
      expect
        .soft(m && c && m.y >= c.y, `menu top ${m?.y} vs composer top ${c?.y}`)
        .toBeTruthy();
      await composer.press("ArrowDown");
      await expect(option.first()).toHaveAttribute("aria-selected", "true");
      await composer.press("Enter");
      await expect(composer).toHaveValue(/^Look at #werk-shots\s?$/);
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await composer.fill("");
      await composer.pressSequentially("`#wer");
      await expect(page.getByRole("listbox")).toHaveCount(0);
    },
    addCard,
  );
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({
  page,
}) => {
  await withChat(REPLY, async (server) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await page.goto(server.url);
    const composer = composerOf(page);
    await composer.pressSequentially("What is wrong here? ");
    await paste(page, "png");
    await expect(composer).toHaveValue("What is wrong here? [Image #1]");
    const chip = chipsOf(page);
    await expect(chip).toContainText("[Image #1]");
    await expect(chip.getByRole("status", { name: "Uploading" })).toBeVisible();
    release();
    await expect(chip.getByRole("img")).toBeVisible();
    await thumbLoaded(chip);
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toContain("Open each image above with Read");
    const stored = readdirSync(attachments(server)).filter((n) =>
      n.endsWith(".png"),
    );
    expect(stored).toHaveLength(1);
    const git = spawnSync("git", ["status", "--porcelain", "-uall"], {
      cwd: server.dir,
      encoding: "utf8",
    });
    expect(git.stdout).not.toContain("attachments");
    const ignored = spawnSync(
      "git",
      ["check-ignore", join(".werk", "attachments", stored[0] as string)],
      { cwd: server.dir, encoding: "utf8" },
    );
    expect(ignored.status).toBe(0);
  });
});

test("24.3 an oversized dropped image is refused and not sent", async ({
  page,
}) => {
  await withChat(REPLY, async (server) => {
    await page.goto(server.url);
    await drop(page, 25 * 1024 * 1024);
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    const chip = chipsOf(page);
    await expect(chip).toContainText("[Image #1]");
    await expect(chip.getByRole("alert")).toContainText("20 MB");
    await composerOf(page).pressSequentially(" hello");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).not.toMatch(/\[Image #1\] = /);
    expect(text).not.toContain("attachments");
    const files = existsSync(attachments(server))
      ? readdirSync(attachments(server)).filter((n) => n !== ".gitignore")
      : [];
    expect(files).toEqual([]);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({
  page,
}) => {
  await withChat(REPLY, async (server) => {
    await page.goto(server.url);
    await paste(page, "png");
    await paste(page, "jpeg");
    const composer = composerOf(page);
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    const chips = chipsOf(page);
    await expect(chips.getByRole("img")).toHaveCount(2);
    await chips.getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer).toHaveValue("[Image #1]");
    await expect(chips.getByRole("listitem")).toHaveCount(1);
    await expect(chips).not.toContainText("[Image #2]");
    await expect(chips.getByRole("img")).toHaveAttribute("src", /\.jpg/);
    await thumbLoaded(chips);
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.jpg/);
    expect(text).not.toContain("[Image #2]");
    expect(text).not.toMatch(/\.png/);
  });
});

test("24.5 a bad image request answers 404 and the server still runs", async ({
  page,
}) => {
  const init = {
    event: {
      type: "system",
      subtype: "init",
      slash_commands: ["review", "recall"],
    },
  };
  await withChat(
    { roles: { chat: { replies: [[init, say("m1", "Hello")]] } } },
    async (server) => {
      await page.goto(server.url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const composer = composerOf(page);
      await composer.fill("hi");
      await composer.press("Enter");
      await expect(chat(page).getByText("Hello")).toBeVisible();
      const api = `${server.origin}/api/projects/project/image`;
      expect((await fetch(`${api}?name=`)).status).toBe(404);
      expect((await fetch(api)).status).toBe(404);
      for (const q of [
        "..%2F..%2Flog.jsonl",
        "..%2Flog.jsonl",
        "%2Fetc%2Fpasswd",
        "..",
      ]) {
        const res = await fetch(`${api}?name=${q}`);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("node.proposed");
      }
      await composer.fill("");
      await composer.pressSequentially("/");
      await expect(page.getByRole("listbox").getByRole("option")).toHaveText([
        "/review",
        "/recall",
      ]);
    },
  );
});

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({
  page,
}) => {
  await withChat(REPLY, async (server) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await page.goto(server.url);
    const composer = composerOf(page);
    await paste(page, "png");
    const chip = chipsOf(page);
    await expect(chip.getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composer).toHaveValue("[Image #1]");
    release();
    await expect(chip.getByRole("img")).toBeVisible();
    await thumbLoaded(chip);
    await expect(chip).toContainText("[Image #1]");
    await composer.pressSequentially(" Why is this red?");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    // The sent message shows the image under its token.
    await expect(chat(page).getByRole("img")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/Open each image above with Read/);
    expect(text).not.toContain("iVBORw0KGgo");
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({
  page,
}) => {
  await withChat(REPLY, async (server) => {
    await page.goto(server.url);
    const composer = composerOf(page);
    await paste(page, 2 * 1024 * 1024);
    const chips = chipsOf(page);
    await expect(chips.getByRole("img")).toHaveCount(1);
    await expect(chips).toContainText("[Image #1]");
    await paste(page, 25 * 1024 * 1024);
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    await expect(chips.getByRole("alert")).toContainText("larger than 20 MB");
    await chips.getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer).not.toHaveValue(/\[Image #2\]/);
    await composer.pressSequentially(" Why is this red?");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).not.toContain("[Image #2]");
    expect(text.match(/\[Image #\d+\] = /g)).toHaveLength(1);
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({
  page,
}) => {
  await withChat(REPLY, async (server) => {
    await page.goto(server.url);
    await paste(page, "png");
    await paste(page, "jpeg");
    const composer = composerOf(page);
    const chips = chipsOf(page);
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    await expect(chips.getByRole("img")).toHaveCount(2);
    await chips.getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer).toHaveValue("[Image #1]");
    await expect(chips).toContainText("[Image #1]");
    await expect(chips).not.toContainText("[Image #2]");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.jpg/);
    expect(text).not.toContain("[Image #2]");
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withChat(REPLY, async (server) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await page.goto(server.url);
    const composer = composerOf(page);
    await paste(page, "png");
    const chip = chipsOf(page);
    await expect(chip.getByRole("status", { name: "Uploading" })).toBeVisible();
    await composer.pressSequentially(" what is this?");
    await composer.press("Enter");
    await expect(chip.getByRole("status", { name: "Uploading" })).toBeVisible();
    expect(messages(server)).toHaveLength(0);
    await expect(chat(page).getByText("Seen")).toHaveCount(0);
    release();
    await expect(
      chip.getByRole("img").or(chat(page).getByText("Seen")).first(),
    ).toBeVisible();
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/what is this\?$/);
  });
});

test("25.5 an image request with no name answers 404 and the server stays up", async ({
  page,
}) => {
  await withChat(REPLY, async (server) => {
    await page.goto(server.url);
    const composer = composerOf(page);
    await paste(page, "png");
    const chip = chipsOf(page);
    await expect(chip.getByRole("img")).toBeVisible();
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const stored = readdirSync(attachments(server)).find((n) =>
      n.endsWith(".png"),
    );
    expect(stored).toBeTruthy();
    const api = `${server.origin}/api/projects/project/image`;
    expect((await fetch(`${api}?name=${stored}`)).status).toBe(200);
    expect((await fetch(`${api}?name=`)).status).toBe(404);
    expect((await fetch(`${api}?name=..%2Flog.jsonl`)).status).toBe(404);
    expect((await fetch(`${api}?name=..%2F..%2Fetc%2Fpasswd`)).status).toBe(
      404,
    );
    await paste(page, "png");
    await expect(chip.getByRole("img")).toBeVisible();
    await thumbLoaded(chip);
    await composer.press("Enter");
    await expect(chat(page).getByText("Again")).toBeVisible();
  });
});
