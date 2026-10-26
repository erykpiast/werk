import { useState, type ReactNode } from 'react'
import type { Card, MapState } from '../map/fold.ts'
import { describeChange, markOf, marksOf, type Mark } from '../map/marks.ts'
import { listMarked, pageOf, type Marked } from '../map/view.ts'
import { cardHash } from './route.ts'

/**
 * The page of one card (#vi-onview): its detail on top, its sub-cards below. The root, a
 * card, a leaf and a source all use this one shape. A leaf has no sub-cards, so its detail
 * fills the page. The detail carries the card's proof (#vi-detail): the excerpts, the
 * evidence as pointers to sources, and the rejected options.
 *
 * A ghost (#werk-propose-new) is drawn grey and dashed where it would sit, with one ✓ that
 * accepts it. The ✓ appends an event, and the page redraws from the log (#werk-write).
 */
export function CardPage({ project, map, id }: { project: string | undefined; map: MapState; id: string | undefined }) {
  const page = pageOf(map, id)
  const name = project ?? 'werk'
  if (!page) {
    return (
      <Frame project={name}>
        <section className="detail" aria-label="card detail">
          <h1>No card #{id}</h1>
          <p className="empty">This card is not in the map. It may have been removed.</p>
        </section>
      </Frame>
    )
  }
  const card = page.card
  return (
    <Frame project={name}>
      {card && (
        <nav className="trail" aria-label="trail">
          <CardLink id={undefined}>
            {name}
          </CardLink>
          {page.trail.map((parent) => (
            <span key={parent.id}>
              {' / '}
              <CardLink id={parent.id}>
                {parent.title}
              </CardLink>
            </span>
          ))}
        </nav>
      )}
      <section className={card?.proposed ? 'detail ghost' : 'detail'} aria-label="card detail">
        <h1>{card ? card.title : name}</h1>
        {card ? <Detail card={card} page={page} /> : page.children.length === 0 && <p className="empty">The map has no cards yet.</p>}
      </section>
      {page.children.length > 0 && (
        <section className="subcards" aria-label="sub-cards">
          <h2>Sub-cards</h2>
          <CardList cards={page.children} />
        </section>
      )}
      {!card && <Staleness marked={listMarked(map)!} />}
    </Frame>
  )
}

/**
 * The staleness view on the root page: every marked card, basis first, each mark with its
 * reopen reason and its trace. It reads the same marks as the command line.
 */
function Staleness({ marked }: { marked: Marked[] }) {
  if (marked.length === 0) return null
  return (
    <section className="subcards" aria-label="staleness">
      <h2>Marked cards</h2>
      <ul className="cards">
        {marked.map(({ card, kind, marks }) => (
          <li key={`${kind} ${card.id}`} className={kind}>
            <CardLink id={card.id}>
              {card.title}
            </CardLink>{' '}
            <StatusBadge card={card} /> <span className={`mark ${kind}`}>{kind}</span>
            <Traces marks={marks} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One line per mark: the changed card as a link, then the trace (#vi-prop-trace). */
function Traces({ marks }: { marks: Mark[] }) {
  return (
    <ul className="traces">
      {marks.map((mark) => (
        <li key={`${mark.because} ${mark.seq}`}>
          <CardLink id={mark.because}>
            #{mark.because}
          </CardLink>{' '}
          {describeChange(mark)}
        </li>
      ))}
    </ul>
  )
}

function Frame({ project, children }: { project: string; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="bar">
        <CardLink id={undefined} className="brand">
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

function Detail({ card, page }: { card: Card; page: NonNullable<ReturnType<typeof pageOf>> }) {
  return (
    <>
      <p className="meta">
        <code>#{card.id}</code> <StatusBadge card={card} /> <MarkBadge card={card} />
        {card.proposed && <Accept id={card.id} />}
        {card.reopen && (
          <span className="reopen">
            {' '}
            reopened, {card.reopen.reason}: {card.reopen.why}
          </span>
        )}
      </p>
      {card.why && <p className="why">{card.why}</p>}
      {card.body && <div className="body">{card.body}</div>}
      {card.whyNot && (
        <p className="why-not">
          <strong>Why not: </strong>
          {card.whyNot}
        </p>
      )}
      {(['stale', 'paused'] as const).map((kind) => {
        const marks = marksOf(card, kind)
        return (
          marks.length > 0 && (
            <section key={kind} className={`part ${kind}`} aria-label={kind}>
              <h2>Why this card is {kind}</h2>
              <Traces marks={marks} />
            </section>
          )
        )
      })}
      {card.review.length > 0 && (
        <Part label="needs review">
          {card.review.map((mark) => (
            <li key={mark.seq}>
              source{' '}
              <CardLink id={mark.because}>
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
          <CardItems cards={page.dependsOn} />
        </Part>
      )}
      {page.evidence.length > 0 && (
        <Part label="evidence">
          <CardItems cards={page.evidence} />
        </Part>
      )}
      {page.supports.length > 0 && (
        <Part label="supports">
          <CardItems cards={page.supports} />
        </Part>
      )}
      {page.options.length > 0 && (
        <Part label="options">
          {page.options.map((option) => (
            <li key={option.id} className={option.proposed ? 'ghost' : undefined}>
              <CardLink id={option.id}>
                {option.title}
              </CardLink>
              {option.whyNot && <span className="why-not"> — rejected: {option.whyNot}</span>}
              {option.proposed && <Accept id={option.id} />}
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

function CardList({ cards }: { cards: Card[] }) {
  return (
    <ul className="cards">
      <CardItems cards={cards} />
    </ul>
  )
}

/**
 * A card in a list. A paused card is drawn grey and keeps its status colour; a stale card is
 * marked red. Stale wins (#pr-wf-paused).
 */
function CardItems({ cards }: { cards: Card[] }) {
  return cards.map((card) => (
    <li key={card.id} className={[markOf(card), card.proposed && 'ghost'].filter(Boolean).join(' ') || undefined}>
      <CardLink id={card.id}>
        {card.title}
      </CardLink>{' '}
      <StatusBadge card={card} /> <MarkBadge card={card} />
      {card.proposed && <Accept id={card.id} />}
    </li>
  ))
}

/** The status of a card, or the kind of any other node. A ghost also says it is proposed. */
function StatusBadge({ card }: { card: Card }) {
  return (
    <>
      <span className={`status ${card.status}`}>{card.kind === 'card' ? card.status : card.kind}</span>
      {card.proposed && <span className="status proposed">proposed</span>}
    </>
  )
}

/** The mark a card shows, with the reopen reason of each mark that put it there. */
function MarkBadge({ card }: { card: Card }) {
  const mark = markOf(card)
  if (mark === undefined) return null
  const reasons = [...new Set(marksOf(card, mark).map((m) => m.reason ?? m.change))]
  return <span className={`mark ${mark}`}>{`${mark}: ${reasons.join(', ')}`}</span>
}

/**
 * The ✓ on one ghost. It asks the server to append one accept event for this id only; there
 * is no batch accept. The map redraws when the live channel says the log changed.
 */
function Accept({ id }: { id: string }) {
  const [error, setError] = useState<string | undefined>()
  const accept = () => {
    setError(undefined)
    fetch('/api/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
      .then(async (res) => {
        if (!res.ok) setError(((await res.json()) as { error: string }).error)
      })
      .catch((reason: Error) => setError(reason.message))
  }
  return (
    <>
      {' '}
      <button type="button" className="accept" aria-label={`accept #${id}`} title="accept this proposal" onClick={accept}>
        ✓
      </button>
      {error && (
        <span role="alert" className="mark">
          {' '}
          {error}
        </span>
      )}
    </>
  )
}

/**
 * A real link to the card's address. Following it changes only the location hash, so the
 * page stays and opens the card. It reads; it never writes (#werk-write).
 */
function CardLink({ id, className, children }: { id: string | undefined; className?: string; children: ReactNode }) {
  return (
    <a href={cardHash(id)} className={className}>
      {children}
    </a>
  )
}
