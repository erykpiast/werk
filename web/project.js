// #werk-projects: the project this page shows, read from its address `/p/<name>/...` (#vi-routes).
// Every request to the project's own /api goes under that prefix, so a page and its live
// stream belong to one project. The list of projects, /api/projects, belongs to none.

import { setCardBase } from './md.js'

const m = /^\/p\/([^/]+)/.exec(location.pathname)
/** The project's name, or null on the page that has no project. */
export const PROJECT = m ? decodeURIComponent(m[1]) : null
/** The project's address prefix, `/p/<name>`, or '' with no project. */
export const BASE = m ? `/p/${m[1]}` : ''
setCardBase(BASE)

/** A storage key of this project. Display settings are shared by every project; the open
 *  view, the tabs and the drafts are the project's own (#werk-projects-display). */
export const projectKey = (key) => (PROJECT === null ? key : `${key}@${PROJECT}`)

// Before projects these keys had no project. The first project opened takes them over.
if (PROJECT !== null) {
  for (const key of ['werk-view', 'werk-tabs-v1']) {
    const old = localStorage.getItem(key)
    if (old === null) continue
    if (localStorage.getItem(projectKey(key)) === null) localStorage.setItem(projectKey(key), old)
    localStorage.removeItem(key)
  }
}

const scoped = (url) => (typeof url === 'string' && url.startsWith('/api/') && !url.startsWith('/api/projects') ? BASE + url : url)
const nativeFetch = window.fetch.bind(window)
window.fetch = (url, init) => nativeFetch(scoped(url), init)
const NativeSource = window.EventSource
window.EventSource = class extends NativeSource {
  constructor(url, init) {
    super(scoped(url), init)
  }
}
