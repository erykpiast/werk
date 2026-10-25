/** Which card the left pane opens and which cards sit under it, read from the shape of the map (#vi-onview). */
export type ShapeNode = { id: string; kind: string };
export type ShapeEdge = { from: string; to: string; type: string };
export type ShapeLike = { nodes: ShapeNode[]; edges: ShapeEdge[] };

const ROOT_ID = "root";

/** The card with the id root, else the first card that refines no other card, else null. */
export function openCardId(shape: ShapeLike): string | null {
  const cards = shape.nodes.filter((node) => node.kind === "card");
  if (cards.some((card) => card.id === ROOT_ID)) return ROOT_ID;
  const children = new Set(
    shape.edges.filter((e) => e.type === "refines").map((e) => e.from),
  );
  return cards.find((card) => !children.has(card.id))?.id ?? null;
}

/** The ids of the cards that refine the card directly, in the order of the shape. */
export function subCardIds(shape: ShapeLike, id: string): string[] {
  return shape.edges
    .filter((e) => e.type === "refines" && e.to === id)
    .map((e) => e.from);
}
