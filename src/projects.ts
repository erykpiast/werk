/**
 * The project list (#werk-projects-list). It belongs to the person, so it lives in their own
 * config folder, outside every project. Remove takes a project off the list and never touches
 * its folder. In dev mode the checkout whose code is running heads the list without being
 * stored (#werk-projects-dev-self).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export type Project = {
  /** The folder name, with its parent's name added when two folders share one
   *  (#werk-projects-names). The address carries it. */
  name: string
  root: string
  /** werk's own checkout in dev mode: always listed, never stored, never removed. */
  self: boolean
  /** The folder is gone. The project does not open. */
  missing: boolean
}

type Stored = { projects: { root: string; added: string }[]; last?: string }

const configDir = () => process.env.WERK_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'werk')
export const listPath = () => join(configDir(), 'projects.json')

/** The checkout whose code is running. */
export const SELF_ROOT = realpathSync(resolve(import.meta.dirname, '..'))

/** Dev mode is the hot-reloading server. The flag lives in the environment, so a reload of
 *  this module keeps it. */
export const devMode = () => process.env.WERK_DEV === '1'

function read(): Stored {
  try {
    const s = JSON.parse(readFileSync(listPath(), 'utf8'))
    return { projects: Array.isArray(s.projects) ? s.projects : [], last: typeof s.last === 'string' ? s.last : undefined }
  } catch {
    return { projects: [] }
  }
}

function write(s: Stored) {
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(listPath(), JSON.stringify(s, null, 2) + '\n')
}

export function listProjects(): Project[] {
  const roots = read().projects.map((p) => p.root)
  const self = devMode() ? [SELF_ROOT] : []
  const all = [...self, ...roots.filter((r) => !self.includes(r))]
  const seen = new Set<string>()
  return all.map((root) => {
    let name = basename(root)
    if (seen.has(name)) name = `${name} (${basename(dirname(root))})`
    seen.add(name)
    return { name, root, self: self.includes(root), missing: !isDir(root) }
  })
}

export const findProject = (name: string) => listProjects().find((p) => p.name === name)
export const projectAt = (root: string) => listProjects().find((p) => p.root === canonical(root))

const isDir = (path: string) => existsSync(path) && statSync(path).isDirectory()
/** One folder has one path on the list, whatever link it was reached through. */
const canonical = (path: string) => (existsSync(path) ? realpathSync(path) : resolve(path))

export const isGitRepo = (root: string) => spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' }).stdout.trim() === 'true'

export class AddRefusal extends Error {
  // A plain field, not a parameter property: Node strips types and cannot run one.
  readonly needsGit: boolean
  constructor(message: string, needsGit = false) {
    super(message)
    this.needsGit = needsGit
  }
}

/** Put a folder on the list (#werk-projects-add). A folder with no map gets an empty one. A
 *  folder with no git repository is refused, with `needsGit` set so the page can offer to
 *  initialise one. Adding a listed folder again changes nothing. */
export function addProject(folder: string): Project {
  const root = canonical(folder)
  if (!isDir(root)) throw new AddRefusal(`${root} is not a folder`)
  const listed = projectAt(root)
  if (listed) return listed
  if (!isGitRepo(root)) throw new AddRefusal(`${root} has no git repository. werk needs git to work on a project.`, true)
  const werk = join(root, '.werk')
  mkdirSync(werk, { recursive: true })
  if (!existsSync(join(werk, 'log.jsonl'))) writeFileSync(join(werk, 'log.jsonl'), '')
  const s = read()
  s.projects.push({ root, added: new Date().toISOString() })
  write(s)
  return projectAt(root)!
}

/** Initialise a git repository in a folder, only after the person agreed to it. */
export function initGit(folder: string): void {
  const root = resolve(folder)
  if (!isDir(root)) throw new AddRefusal(`${root} is not a folder`)
  const r = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git init failed in ${root}: ${r.stderr.trim()}`)
}

/** Take a project off the list. Its folder and its map stay as they are. */
export function removeProject(name: string): void {
  const p = findProject(name)
  if (!p) throw new Error(`no project named "${name}"`)
  if (p.self) throw new Error(`"${name}" is werk itself in dev mode, and stays on the list`)
  const s = read()
  s.projects = s.projects.filter((e) => e.root !== p.root)
  if (s.last === p.root) s.last = undefined
  write(s)
}

/** The project an address with no project opens: the last one used that still opens. */
export function lastProject(): Project | undefined {
  const all = listProjects().filter((p) => !p.missing)
  const last = read().last
  return all.find((p) => p.root === last) ?? all[0]
}

export function useProject(p: Project): void {
  const s = read()
  if (s.last === p.root) return
  s.last = p.root
  write(s)
}
