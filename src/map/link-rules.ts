/**
 * The rules for one link between two nodes: which links are allowed, and when.
 * See #werk-cli-link, #vi-prop-linkwhy, #vi-prop-nolineage and #ro-optparent.
 */
import type { Edge, FoldedMap, Violation } from "./fold.ts";

/** Whether `ancestor` is `id` itself or sits above it in the refines tree. */
export function isAtOrAbove(
  map: FoldedMap,
  ancestor: string,
  id: string,
): boolean {
  const seen = new Set<string>();
  for (
    let at: string | undefined = id;
    at !== undefined;
    at = map.parents.get(at)
  ) {
    if (at === ancestor) return true;
    if (seen.has(at)) return false;
    seen.add(at);
  }
  return false;
}

/** Whether two cards are one card, or one sits above the other in the refines tree. */
export function sameLine(map: FoldedMap, a: string, b: string): boolean {
  return isAtOrAbove(map, a, b) || isAtOrAbove(map, b, a);
}

/** The rule a link breaks, or null when the map may take it. */
export function checkLink(map: FoldedMap, edge: Edge): Violation | null {
  const from = map.nodes.get(edge.from);
  if (!from) {
    return { rule: "unknown-card", detail: `no card "${edge.from}"` };
  }
  if (!map.nodes.has(edge.to)) {
    return { rule: "unknown-card", detail: `no card "${edge.to}"` };
  }
  if (from.kind === "option" && edge.type !== "alternative_to") {
    return {
      rule: "option-link",
      detail: `option "${edge.from}" links by alternative_to only, not ${edge.type}`,
    };
  }
  if (edge.type === "depends_on") {
    if (edge.why.trim() === "") {
      return {
        rule: "link-why",
        detail: `a depends_on link needs a reason: what "${edge.from}" takes from "${edge.to}"`,
      };
    }
    if (sameLine(map, edge.from, edge.to)) {
      return {
        rule: "lineage",
        detail: `"${edge.from}" and "${edge.to}" are the same card or one is an ancestor of the other; the refines tree already says it`,
      };
    }
  }
  if (edge.type === "refines") {
    const parent = map.parents.get(edge.from);
    if (parent !== undefined) {
      return {
        rule: "second-parent",
        detail: `"${edge.from}" already has the parent "${parent}"`,
      };
    }
    if (isAtOrAbove(map, edge.from, edge.to)) {
      return {
        rule: "cycle",
        detail: `"${edge.from}" refines "${edge.to}", which sits at or below it`,
      };
    }
  }
  return null;
}
