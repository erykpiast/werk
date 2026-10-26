import type { MouseEvent, ReactNode } from 'react'
import type { Card, MapState } from '../map/fold.ts'
import { pageOf } from '../map/view.ts'
import { cardPath } from './route.ts'

type Open = (id: string | undefined) => void

/**
 * The page of one card (#vi-onview): its detail on top, its sub-cards below. The root, a
 * card, a leaf and a source all use this one shape. A leaf has no sub-cards, so its detail
 * fills the page. The detail carries the card's proof (#vi-detail): the excerpts, the
 * evidence as pointers to sources, and the rejected options.
 */
export function CardPage({ project, map, id, onOpen }: { project: string | undefined; map: MapState; id: string | undefined; onOpen: Open }) {
  const page = pageOf(map, id)
  const name = project ?? 'werk'
  if (!page) {
    return (
      <Frame project={name} onOpen={onOpen}>
        <section className="detail" aria-label="card detail">
          <h1>No card #{id}</h1>
          <p className="empty">This card is not in the map. It may have been removed.</p>
        </section>
      </Frame>
    )
  }
  const card = page.card
  return (
    <Frame project={name} onOpen={onOpen}>
      {card && (
        <nav className="trail" aria-label="trail">
          <CardLink id={undefined} onOpen={onOpen}>
            {name}
          </CardLink>
          {page.trail.map((parent) => (
            <span key={parent.id}>
              {' / '}
              <CardLink id={parent.id} onOpen={onOpen}>
                {parent.title}
              </CardLink>
            </span>
          ))}
        </nav>
      )}
      <section className="detail" aria-label="card detail">
        <h1>{card ? card.title : name}</h1>
        {card ? <Detail card={card} page={page} onOpen={onOpen} /> : page.children.length === 0 && <p className="empty">The map has no cards yet.</p>}
      </section>
      {page.children.length > 0 && (
        <section className="subcards" aria-label="sub-cards">
          <h2>Sub-cards</h2>
          <CardList cards={page.children} onOpen={onOpen} />
        </section>
      )}
    </Frame>
  )
}

function Frame({ project, onOpen, children }: { project: string; onOpen: Open; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="bar">
        <CardLink id={undefined} onOpen={onOpen} className="brand">
          werk
        </CardLink>
        <span className="project">{project}</span>
      </header>
      <main className="page" aria-label="map">
        {children}
      </main>
    </div>
  )
}

function Detail({ card, page, onOpen }: { card: Card; page: NonNullable<ReturnType<typeof pageOf>>; onOpen: Open }) {
  return (
    <>
      <p className="meta">
        <code>#{card.id}</code> <span className={`status ${card.status}`}>{card.kind === 'card' ? card.status : card.kind}</span>
      </p>
      {card.why && <p className="why">{card.why}</p>}
      {card.body && <div className="body">{card.body}</div>}
      {card.whyNot && (
        <p className="why-not">
          <strong>Why not: </strong>
          {card.whyNot}
        </p>
      )}
      {card.stale.length > 0 && (
        <Part label="stale">
          {card.stale.map((mark) => (
            <li key={mark.seq}>
              <CardLink id={mark.because} onOpen={onOpen}>
                #{mark.because}
              </CardLink>{' '}
              changed, over {mark.via}
              {mark.why && `: ${mark.why}`}
            </li>
          ))}
        </Part>
      )}
      {card.review.length > 0 && (
        <Part label="needs review">
          {card.review.map((mark) => (
            <li key={mark.seq}>
              source{' '}
              <CardLink id={mark.because} onOpen={onOpen}>
                #{mark.because}
              </CardLink>{' '}
              is disputed{mark.why && `: ${mark.why}`}
            </li>
          ))}
        </Part>
      )}
      {card.says.length > 0 && (
        <section className="part" aria-label="said">
          <h2>Said</h2>
          {card.says.map((say) => (
            <figure key={say.seq} className="say">
              <blockquote>{say.text}</blockquote>
              <figcaption>— {say.who}</figcaption>
            </figure>
          ))}
        </section>
      )}
      {page.dependsOn.length > 0 && (
        <Part label="depends on">
          <CardItems cards={page.dependsOn} onOpen={onOpen} />
        </Part>
      )}
      {page.evidence.length > 0 && (
        <Part label="evidence">
          <CardItems cards={page.evidence} onOpen={onOpen} />
        </Part>
      )}
      {page.supports.length > 0 && (
        <Part label="supports">
          <CardItems cards={page.supports} onOpen={onOpen} />
        </Part>
      )}
      {page.options.length > 0 && (
        <Part label="options">
          {page.options.map((option) => (
            <li key={option.id}>
              <CardLink id={option.id} onOpen={onOpen}>
                {option.title}
              </CardLink>
              {option.whyNot && <span className="why-not"> — rejected: {option.whyNot}</span>}
            </li>
          ))}
        </Part>
      )}
    </>
  )
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="part" aria-label={label}>
      <h2>{label[0]!.toUpperCase() + label.slice(1)}</h2>
      <ul>{children}</ul>
    </section>
  )
}

function CardList({ cards, onOpen }: { cards: Card[]; onOpen: Open }) {
  return (
    <ul className="cards">
      <CardItems cards={cards} onOpen={onOpen} />
    </ul>
  )
}

function CardItems({ cards, onOpen }: { cards: Card[]; onOpen: Open }) {
  return cards.map((card) => (
    <li key={card.id}>
      <CardLink id={card.id} onOpen={onOpen}>
        {card.title}
      </CardLink>{' '}
      <span className={`status ${card.status}`}>{card.kind === 'card' ? card.status : card.kind}</span>
      {card.stale.length > 0 && <span className="mark"> stale</span>}
    </li>
  ))
}

/** A real link, so the address can be copied and opened in a new tab. A plain click stays in the page. */
function CardLink({ id, onOpen, className, children }: { id: string | undefined; onOpen: Open; className?: string; children: ReactNode }) {
  const click = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(id)
  }
  return (
    <a href={cardPath(id)} onClick={click} className={className}>
      {children}
    </a>
  )
}
