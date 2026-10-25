/**
 * The card-scoped read API: one card with its neighbours, and the shape of the whole map
 * without a single card body (#werk-stack-api).
 */
import type { Edge, FoldedMap, LinkType, Mark, Status } from "../map/fold.ts";
import { type Rollup, rollups } from "../map/rollup.ts";

export type Neighbour = {
  id: string;
  title: string;
  type: LinkType;
  /** "out" when the card is the `from` end of the edge, "in" when it is the `to` end. */
  direction: "out" | "in";
};

export type CardRead = {
  id: string;
  kind: string;
  title: string;
  why: string;
  body: string;
  status: Status;
  proposed: boolean;
  marks: Mark[];
  neighbours: Neighbour[];
};

export type Shape = {
  nodes: {
    id: string;
    kind: string;
    status: Status;
    proposed: boolean;
    marks: Mark[];
  }[];
  edges: { from: string; to: string; type: LinkType; held: boolean }[];
  /** Per card: the counts over its subtree. A ghost counts in no rollup. */
  rollups: Record<string, Rollup>;
};

/** The card with its words and the ids and titles of the cards it links to, or null when the map has none. */
export function cardRead(map: FoldedMap, id: string): CardRead | null {
  const node = map.nodes.get(id);
  if (!node) return null;
  const edges: Edge[] = node.proposed
    ? [...map.edges, ...map.ghostEdges]
    : map.edges;
  const neighbours: Neighbour[] = [];
  for (const edge of edges) {
    if (edge.from !== id && edge.to !== id) continue;
    const direction = edge.from === id ? "out" : "in";
    const other = map.nodes.get(direction === "out" ? edge.to : edge.from);
    if (other) {
      neighbours.push({
        id: other.id,
        title: other.title,
        type: edge.type,
        direction,
      });
    }
  }
  const { proposed, marks, kind, title, why, body, status } = node;
  return { id, kind, title, why, body, status, proposed, marks, neighbours };
}

/** Everything the tree, the rollup bars and the graph need, and no body. */
export function shapeRead(map: FoldedMap): Shape {
  return {
    nodes: [...map.nodes.values()].map((node) => ({
      id: node.id,
      kind: node.kind,
      status: node.status,
      proposed: node.proposed,
      marks: node.marks,
    })),
    edges: [
      ...map.edges.map((e) => ({
        from: e.from,
        to: e.to,
        type: e.type,
        held: false,
      })),
      ...map.ghostEdges.map((e) => ({
        from: e.from,
        to: e.to,
        type: e.type,
        held: true,
      })),
    ],
    rollups: rollups(map),
  };
}
