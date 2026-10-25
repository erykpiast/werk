/** The titles of a project's build-rule cards: every card under the build-rules card (#st-build-howto-titles). */
import type { FoldedMap } from "../map/fold.ts";

/** The fixed id of the card that holds the build rules. */
export const BUILD_RULES_ID = "how";

export function buildRuleTitles(map: FoldedMap): string[] {
  const titles: string[] = [];
  const seen = new Set<string>([BUILD_RULES_ID]);
  const queue = [BUILD_RULES_ID];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const edge of map.edges) {
      if (edge.type !== "refines" || edge.to !== id || seen.has(edge.from)) {
        continue;
      }
      const node = map.nodes.get(edge.from);
      if (node?.kind !== "card") continue;
      seen.add(edge.from);
      queue.push(edge.from);
      titles.push(`#${node.id} — ${node.title}`);
    }
  }
  return titles;
}
