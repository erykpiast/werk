/** What the routes need from whatever serves the client: the page, and the files the page loads. */
export type ClientServer = {
  /** The client's page, with the token in it. */
  page(token: string): Promise<Response>;
  /** The file a request asks for, or null when the client has none. */
  asset(req: Request): Promise<Response | null>;
};
