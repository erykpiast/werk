import { useEffect, useState } from 'react'
import type { MapState } from '../map/fold.ts'
import { CardPage } from './CardPage.tsx'
import { cardIdFromPath, cardPath } from './route.ts'

/**
 * Loads the project name and the folded map, and shows the page of the card that the
 * address names. Opening a card puts it in the address, so Back and a reload both work.
 */
export function App() {
  const [project, setProject] = useState<string | undefined>()
  const [map, setMap] = useState<MapState | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [id, setId] = useState(() => cardIdFromPath(location.pathname))

  useEffect(() => {
    let cancelled = false
    fetch('/api/project')
      .then((res) => res.json() as Promise<{ name: string }>)
      .then((body) => {
        if (!cancelled) setProject(body.name)
      })
      .catch(() => {})
    fetch('/api/map')
      .then(async (res) => {
        const body = (await res.json()) as MapState | { error: string }
        if (cancelled) return
        if ('error' in body) setError(body.error)
        else setMap(body)
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onPop = () => setId(cardIdFromPath(location.pathname))
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  const open = (next: string | undefined) => {
    history.pushState(null, '', cardPath(next))
    setId(next)
    scrollTo(0, 0)
  }

  if (error) return <p role="alert">The map did not load: {error}</p>
  if (!map) return <p className="empty">Loading the map…</p>
  return <CardPage project={project} map={map} id={id} onOpen={open} />
}
