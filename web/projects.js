// #werk-projects-switcher: the project switcher at the left of the sticky header, and the page
// that stands in for the map when the address names no project that opens.

import { PROJECT } from './project.js'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const el = (id) => document.getElementById(id)
const go = (name) => location.assign(`/p/${encodeURIComponent(name)}`)

let list = { projects: [], home: '' }

async function fetchList() {
  try {
    list = await (await fetch('/api/projects')).json()
  } catch {
    // The server is restarting. The live stream reconnects and asks again.
  }
}

const shortPath = (root) => (list.home && root.startsWith(list.home + '/') ? '~' + root.slice(list.home.length) : root)

function renderButton() {
  el('project-btn').innerHTML = `<span class="pj-cur">${esc(PROJECT ?? 'no project')}</span><span class="pj-caret">▾</span>`
}

function renderMenu() {
  const rows = list.projects.map((p) => {
    const cls = ['pj-row', p.name === PROJECT ? 'current' : '', p.missing ? 'missing' : ''].filter(Boolean).join(' ')
    const dot = p.running.length ? `<span class="pj-dot busy" title="An agent turn is running: ${esc(p.running.join(', '))}"></span>` : '<span class="pj-dot"></span>'
    return `<div class="${cls}" data-name="${esc(p.name)}">
      ${dot}<span class="pj-name">${esc(p.name)}</span>
      <span class="pj-path">${esc(shortPath(p.root))}${p.missing ? ' (missing)' : ''}</span>
      ${p.self ? '' : `<button type="button" class="pj-x" data-remove="${esc(p.name)}" title="Remove from the list. The folder and its map stay.">×</button>`}
    </div>`
  })
  el('project-menu').innerHTML = `${rows.join('')}<div class="pj-sep"></div><button type="button" class="pj-add" data-add>+ Add project…</button>`
}

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}

/** #werk-projects-add: the folder dialog, then the add. A folder with no git repository is
 *  refused; the person may let werk initialise one. */
async function addProject() {
  const picked = await post('/api/projects/pick', {})
  if (!picked.body.ok) return alert(picked.body.error)
  if (!picked.body.path) return
  let r = await post('/api/projects/add', { root: picked.body.path })
  if (!r.body.ok && r.body.needsGit) {
    if (!confirm(`${r.body.error}\n\nInitialise a git repository in ${picked.body.path}?`)) return
    r = await post('/api/projects/add', { root: picked.body.path, init: true })
  }
  if (!r.body.ok) return alert(r.body.error)
  go(r.body.project.name)
}

/** #werk-projects-list: remove takes the project off the list. Running turns are named and
 *  stopped only after a confirmation. */
async function removeProject(name) {
  let r = await post('/api/projects/remove', { name })
  if (r.status === 409 && r.body.running) {
    if (!confirm(`"${name}" has running agent turns: ${r.body.running.join(', ')}.\n\nStop them and remove the project from the list?`)) return
    r = await post('/api/projects/remove', { name, force: true })
  }
  if (!r.body.ok) return alert(r.body.error)
  if (name === PROJECT) return location.assign('/')
  await refreshProjects()
}

/** The page in place of the map: no project yet, an unknown name, or a missing folder. */
function renderPage(p) {
  const known = list.projects.filter((x) => !x.missing && x.name !== PROJECT)
  const others = known.length ? `<p>Open one of: ${known.map((x) => `<a href="/p/${encodeURIComponent(x.name)}">${esc(x.name)}</a>`).join(', ')}</p>` : ''
  const text =
    PROJECT === null
      ? '<h1>werk has no project yet</h1><p>A project is a folder with a git repository. werk keeps its map in that folder.</p>'
      : p
        ? `<h1>The folder of ${esc(p.name)} is missing</h1><p>${esc(p.root)} was moved or deleted. Remove the project from the list, or put the folder back.</p>${p.self ? '' : `<button type="button" class="pj-page-btn" data-remove="${esc(p.name)}">Remove ${esc(p.name)} from the list</button>`}`
        : `<h1>No project named ${esc(PROJECT)}</h1>`
  el('project-page').innerHTML = `<div class="pj-page-body">${text}${others}<button type="button" class="pj-page-btn" data-add>+ Add project…</button></div>`
  el('project-page').hidden = false
  document.body.classList.add('no-project')
}

export async function refreshProjects() {
  await fetchList()
  renderButton()
  if (!el('project-menu').hidden) renderMenu()
}

/** Draw the switcher. Resolves to true when the address names a project that opens, so the
 *  map can start; otherwise the page in place of the map is shown. */
export async function initProjects() {
  await fetchList()
  renderButton()
  const menu = el('project-menu')
  el('project-btn').addEventListener('click', () => {
    menu.hidden = !menu.hidden
    if (!menu.hidden) renderMenu()
  })
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('#project')) menu.hidden = true
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menu.hidden = true
  })
  document.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove]')
    if (remove) return removeProject(remove.dataset.remove)
    if (e.target.closest('[data-add]')) return addProject()
    const row = e.target.closest('#project-menu .pj-row')
    if (row && !row.classList.contains('missing') && row.dataset.name !== PROJECT) go(row.dataset.name)
  })
  const p = list.projects.find((x) => x.name === PROJECT)
  if (p && !p.missing) return true
  renderPage(p)
  return false
}
