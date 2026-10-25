/** The request handler: trust check first, then the route, and a throw answers 500 (#werk-serve-trust, #werk-crash). */
import { judgeRequest } from "./trust.ts";

export const TOKEN_HEADER = "x-werk-token";

export type Route = (req: Request) => Response | Promise<Response>;
export type Handler = (req: Request) => Promise<Response>;

export function createHandler(
  token: string,
  route: Route,
  log: (text: string) => void = console.error,
): Handler {
  return async (req) => {
    try {
      const trust = judgeRequest({
        method: req.method,
        host: req.headers.get("host"),
        token: req.headers.get(TOKEN_HEADER),
        expected: token,
      });
      if (!trust.ok) return new Response(trust.reason, { status: 403 });
      return await route(req);
    } catch (error) {
      log(`werk: request failed: ${req.method} ${req.url}: ${String(error)}`);
      return new Response("internal error", { status: 500 });
    }
  };
}
