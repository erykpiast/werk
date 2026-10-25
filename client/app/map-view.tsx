import type { CardView, MapState } from "../lib/map-store";

function SubCard({ card }: { card: CardView }) {
  return (
    <li className="rounded-md border border-border p-3" data-card-id={card.id}>
      <div className="text-xs text-muted-foreground">
        #{card.id} · {card.proposed ? "proposed" : card.status}
      </div>
      <div className="font-medium">{card.title}</div>
      {card.why !== "" && (
        <p className="text-sm text-muted-foreground">{card.why}</p>
      )}
    </li>
  );
}

/** The map view: the open card on top, its sub-cards below (#vi-onview). */
export function MapView({ map }: { map: MapState }) {
  if (!map.loaded) return <p className="p-4">Loading the map…</p>;
  if (!map.open) return <p className="p-4">The map has no cards yet.</p>;
  return (
    <article className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{map.open.title}</h1>
      {map.open.why !== "" && <p>{map.open.why}</p>}
      {map.open.body !== "" && (
        <p className="whitespace-pre-wrap">{map.open.body}</p>
      )}
      {map.subCards.length > 0 && (
        <ul aria-label="Sub-cards" className="grid gap-2">
          {map.subCards.map((card) => (
            <SubCard key={card.id} card={card} />
          ))}
        </ul>
      )}
    </article>
  );
}
