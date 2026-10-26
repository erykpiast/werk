// The project list (#werk-projects-list). I/O: a config file and real folders with git, so
// each behaviour is a named responsibility, run against a scratch config and scratch folders.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AddRefusal, addProject, initGit, lastProject, listPath, listProjects, removeProject, SELF_ROOT, useProject } from './projects.ts'
import { scratchDir } from './test/harness.ts'

let dir: string
const saved = { config: process.env.WERK_CONFIG_DIR, dev: process.env.WERK_DEV }

function folder(path: string, git = true): string {
  const root = join(dir, path)
  mkdirSync(root, { recursive: true })
  if (git) Bun.spawnSync(['git', 'init', '-q'], { cwd: root })
  return root
}

beforeEach(() => {
  dir = scratchDir('werk-projects-')
  process.env.WERK_CONFIG_DIR = join(dir, 'config')
  delete process.env.WERK_DEV
})

afterEach(() => {
  process.env.WERK_CONFIG_DIR = saved.config
  if (saved.dev === undefined) delete process.env.WERK_DEV
  else process.env.WERK_DEV = saved.dev
})

describe('the project list', () => {
  test('an added folder stays on the list, kept outside every project', () => {
    const a = folder('a')
    addProject(a)
    expect(listProjects().map((p) => p.name)).toEqual(['a'])
    expect(listPath().startsWith(join(dir, 'config'))).toBe(true)
    expect(JSON.parse(readFileSync(listPath(), 'utf8')).projects).toHaveLength(1)
  })

  test('a folder with no map gets an empty one, and a map that is there is left as it is', () => {
    const fresh = folder('fresh')
    addProject(fresh)
    expect(readFileSync(join(fresh, '.werk', 'log.jsonl'), 'utf8')).toBe('')
    const used = folder('used')
    mkdirSync(join(used, '.werk'))
    writeFileSync(join(used, '.werk', 'log.jsonl'), '{"seq":1}\n')
    addProject(used)
    expect(readFileSync(join(used, '.werk', 'log.jsonl'), 'utf8')).toBe('{"seq":1}\n')
  })

  test('a folder with no git repository is refused, nothing is written, and it can be added once git is there', () => {
    const plain = folder('plain', false)
    let refusal: unknown
    try {
      addProject(plain)
    } catch (err) {
      refusal = err
    }
    expect(refusal).toBeInstanceOf(AddRefusal)
    expect((refusal as AddRefusal).needsGit).toBe(true)
    expect(existsSync(join(plain, '.werk'))).toBe(false)
    expect(listProjects()).toEqual([])
    initGit(plain)
    expect(addProject(plain).name).toBe('plain')
  })

  test('one folder is listed once, whatever path reaches it', () => {
    const a = folder('a')
    symlinkSync(a, join(dir, 'link'))
    addProject(a)
    addProject(join(dir, 'link'))
    expect(listProjects()).toHaveLength(1)
  })

  test('two folders with one name: the later one adds its parent folder name', () => {
    addProject(folder('work/api'))
    addProject(folder('home/api'))
    expect(listProjects().map((p) => p.name)).toEqual(['api', 'api (home)'])
  })

  test('remove takes a project off the list and never touches its folder or map', () => {
    const a = folder('a')
    addProject(a)
    removeProject('a')
    expect(listProjects()).toEqual([])
    expect(existsSync(join(a, '.werk', 'log.jsonl'))).toBe(true)
  })

  test('a deleted folder shows as missing, stays listed, and is never the project an address opens', () => {
    const a = folder('a')
    const b = folder('b')
    addProject(a)
    addProject(b)
    useProject(listProjects()[1])
    rmSync(b, { recursive: true })
    expect(listProjects().find((p) => p.name === 'b')?.missing).toBe(true)
    expect(lastProject()?.name).toBe('a')
  })

  test('the address with no project opens the project used last', () => {
    addProject(folder('a'))
    addProject(folder('b'))
    expect(lastProject()?.name).toBe('a')
    useProject(listProjects()[1])
    expect(lastProject()?.name).toBe('b')
  })

  test('in dev mode werk itself heads the list, is never stored, and cannot be removed', () => {
    process.env.WERK_DEV = '1'
    addProject(folder('a'))
    const self = listProjects()[0]
    expect(self.root).toBe(SELF_ROOT)
    expect(self.self).toBe(true)
    expect(JSON.parse(readFileSync(listPath(), 'utf8')).projects.map((p: { root: string }) => p.root)).not.toContain(SELF_ROOT)
    expect(() => removeProject(self.name)).toThrow('stays on the list')
    delete process.env.WERK_DEV
    expect(listProjects().map((p) => p.root)).not.toContain(SELF_ROOT)
  })
})
