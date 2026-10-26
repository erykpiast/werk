// Held-out step 10.2: the person types notes in the map, the agent reads them with werk inbox.
import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

const texts = (out: string) =>
  [...out.matchAll(/^\[(\d+)\] #(\S+).*\n\s+(.+)$/gm)].map(([, seq, id, text]) => ({ seq, id, text }));

test("10.2", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);
  await expect(p.locator('[data-section="thread"] [data-entry="note"]')).toHaveCount(4);

  const all = texts(w.werk("inbox"));
  console.log("10.2 inbox:", all);
  expect(all.map((e) => e.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(all.every((e) => e.id === "auth-login" && /^\d+$/.test(e.seq))).toBe(true);
  const first = all[0]?.seq as string;
  expect(texts(w.werk("inbox", "--since", first)).map((e) => e.text)).toEqual(["second", "third", "fourth"]);
  expect(texts(w.werk("inbox", "--since", first, "-n", "2")).map((e) => e.text)).toEqual(["second", "third"]);
});
