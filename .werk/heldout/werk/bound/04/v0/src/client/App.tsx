import { useEffect, useState } from 'react'
import type { MapState } from '../map/fold.ts'
import { CardPage } from './CardPage.tsx'
import { cardIdFromHash } from './route.ts'

/**
 * Loads the project name and the folded map, and shows the page of the card that the
 * location hash names. Opening a card changes the hash, so Back and a reload both work.
 * When the server says on the live channel that the log changed, it fetches the fold again
 * (#werk-write): the page only reads, and redraws from the log.
 */
export function App() {
  const [project, setProject] = useState<string | undefined>()
  const [map, setMap] = useState<MapState | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [id, setId] = useState(() => cardIdFromHash(location.hash))

  useEffect(() => {
    let cancelled = false
    fetch('/api/project')
      .then((res) => res.json() as Promise<{ name: string }>)
      .then((body) => {
        if (!cancelled) setProject(body.name)
      })
      .catch(() => {})
    // Only the latest fetch may set the map, so a slow older answer never draws over a newer one.
    let latest = 0
    const load = () => {
      const mine = ++latest
      fetch('/api/map')
        .then(async (res) => {
          const body = (await res.json()) as MapState | { error: string }
          if (cancelled || mine !== latest) return
          if ('error' in body) {
            setError(body.error)
          } else {
            setError(undefined)
            setMap(body)
          }
        })
        .catch((reason: Error) => {
          if (!cancelled && mine === latest) setError(reason.message)
        })
    }
    load()
    const live = new EventSource('/api/live')
    live.addEventListener('changed', load)
    // The channel reconnects by itself after a server restart. A write made in the gap sent
    // no changed, so each new connection fetches the fold again.
    live.addEventListener('hello', load)
    return () => {
      cancelled = true
      live.close()
    }
  }, [])

  useEffect(() => {
    const onHash = () => {
      setId(cardIdFromHash(location.hash))
      scrollTo(0, 0)
    }
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  if (error) return <p role="alert">The map did not load: {error}</p>
  if (!map) return <p className="empty">Loading the map…</p>
  return <CardPage project={project} map={map} id={id} />
}
