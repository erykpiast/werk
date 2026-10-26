import type { H } from "./lib.ts";

/** Seeds a decided basis card "base" with whatever the contract needs, so it can be linked to. */
export function base(h: H, id = "base") {
  h.card(id, { status: "decided", who: "me", title: id });
}
/** Seeds an open card with who, a depends_on basis, and a rejected option. No kill criterion. */
export function nearlyReady(h: H, id: string, status = "open") {
  base(h);
  h.card(id, { status, who: "you", title: id });
  h.seed("edge.added", { from: id, to: "base", type: "depends_on", why: "takes the base" });
  h.seed("node.added", { id: `${id}:opt0`, kind: "option", title: "alt", why_not: "lost" });
  h.seed("edge.added", { from: `${id}:opt0`, to: id, type: "alternative_to" });
}
export const dep = (h: H, from: string, to: string, why = "needs it") =>
  h.seed("edge.added", { from, to, type: "depends_on", why });
