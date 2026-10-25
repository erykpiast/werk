/**
 * The "Add project…" action: the server opens the folder dialog, the page sends the folder back, and a folder
 * with no git repository is turned into one only when the person agrees (#werk-projects-add).
 */
import { pageOf } from "./project-route";

export type AddDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The server token of the page. */
  token: string;
  /** Asks the person; true when they agree. */
  confirm: (question: string) => boolean;
  /** Opens a page address. */
  go: (path: string) => void;
};

/** Returns an error line to show, or null when the project opened or the person cancelled. */
export async function addProjectFromDialog(
  deps: AddDeps,
): Promise<string | null> {
  const post = (url: string, body?: unknown) =>
    deps.fetch(url, {
      method: "POST",
      headers: {
        "x-werk-token": deps.token,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const dialog = await post("/api/projects/dialog");
  if (!dialog.ok) return `the folder dialog failed (${dialog.status})`;
  const chosen = (await dialog.json()) as { folder?: string };
  if (chosen.folder === undefined) return null;

  let res = await post("/api/projects", { folder: chosen.folder });
  let body = (await res.json()) as {
    name?: string;
    error?: string;
    message?: string;
  };
  if (res.status === 409 && body.error === "git-required") {
    if (
      !deps.confirm(
        `${body.message ?? "git is required"}\n\nStart a git repository there?`,
      )
    ) {
      return null;
    }
    res = await post("/api/projects", { folder: chosen.folder, init: true });
    body = (await res.json()) as typeof body;
  }
  if (!res.ok || body.name === undefined) {
    return body.message ?? `the server answered ${res.status}`;
  }
  deps.go(pageOf(body.name));
  return null;
}
