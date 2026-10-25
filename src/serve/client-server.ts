import { injectToken } from "./page-html.ts";

/** What the routes need from whatever serves the client: the page, and the files the page loads. */
export type ClientServer = {
  /** The client's page, with the token in it. */
  page(token: string): Promise<Response>;
  /** The file a request asks for, or null when the client has none. */
  asset(req: Request): Promise<Response | null>;
};

/** The client of a server that does not run Vite: no page and no files. */
export const noClient: ClientServer = {
  async page(token) {
    const html =
      "<!doctype html><title>werk</title><p>The client runs in dev mode only. Set WERK_DEV=1.</p>";
    return new Response(injectToken(html, token), {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
  async asset() {
    return null;
  },
};
