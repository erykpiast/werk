import { expect, test } from "bun:test";
import { type AddDeps, addProjectFromDialog } from "./add-project";

/** A server that answers each path with the next reply that the test queued for it. */
function setup(replies: Record<string, Response[]>, agree = true) {
  const calls: { url: string; body: unknown; token: string | null }[] = [];
  const went: string[] = [];
  const deps: AddDeps = {
    token: "tok",
    confirm: () => agree,
    go: (path) => void went.push(path),
    fetch: async (url, init) => {
      calls.push({
        url,
        body:
          init.body === undefined ? undefined : JSON.parse(String(init.body)),
        token: new Headers(init.headers).get("x-werk-token"),
      });
      return (replies[url] as Response[]).shift() as Response;
    },
  };
  return { deps, calls, went };
}

test("a chosen folder is added and its project opens", async () => {
  const t = setup({
    "/api/projects/dialog": [Response.json({ folder: "/a/api" })],
    "/api/projects": [Response.json({ name: "api (a)" })],
  });
  expect(await addProjectFromDialog(t.deps)).toBeNull();
  expect(t.went).toEqual(["/p/api%20(a)"]);
  expect(t.calls.every((c) => c.token === "tok")).toBe(true);
});

test("a cancelled dialog adds nothing", async () => {
  const t = setup({
    "/api/projects/dialog": [Response.json({ cancelled: true })],
  });
  expect(await addProjectFromDialog(t.deps)).toBeNull();
  expect(t.calls).toHaveLength(1);
  expect(t.went).toEqual([]);
});

test("a folder with no git repository starts one only when the person agrees", async () => {
  const gitless = () =>
    Response.json(
      { error: "git-required", message: "git is required" },
      { status: 409 },
    );
  const yes = setup({
    "/api/projects/dialog": [Response.json({ folder: "/a/x" })],
    "/api/projects": [gitless(), Response.json({ name: "x" })],
  });
  expect(await addProjectFromDialog(yes.deps)).toBeNull();
  expect(yes.calls.at(-1)?.body).toEqual({ folder: "/a/x", init: true });
  expect(yes.went).toEqual(["/p/x"]);

  const no = setup(
    {
      "/api/projects/dialog": [Response.json({ folder: "/a/x" })],
      "/api/projects": [gitless()],
    },
    false,
  );
  expect(await addProjectFromDialog(no.deps)).toBeNull();
  expect(no.calls).toHaveLength(2);
  expect(no.went).toEqual([]);
});

test("a refusal and a failed dialog come back as an error line", async () => {
  const refused = setup({
    "/api/projects/dialog": [Response.json({ folder: "/a/x" })],
    "/api/projects": [
      Response.json({ message: "not a folder" }, { status: 400 }),
    ],
  });
  expect(await addProjectFromDialog(refused.deps)).toBe("not a folder");
  const failed = setup({
    "/api/projects/dialog": [new Response("no", { status: 500 })],
  });
  expect(await addProjectFromDialog(failed.deps)).toContain("500");
});
