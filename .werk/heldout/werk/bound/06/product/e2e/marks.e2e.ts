import { spawnSync } from 'node:child_process'
import { CLI, testEnv } from '../test/env.ts'
import { fixtureProject } from './fixture.ts'
import { expect, test } from './test.ts'

/** Runs a werk command in the project the page shows. Playwright runs under Node, so it names bun. */
function werk(port: string, ...args: string[]): void {
  const result = spawnSync('bun', [CLI, ...args], { cwd: fixtureProject(port), env: testEnv(), encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`werk ${args.join(' ')} failed: ${result.stderr}`)
}

const GREY = 'rgb(138, 138, 138)'
const GREEN = 'rgb(46, 139, 87)'
const RED = 'rgb(192, 57, 43)'

test('a postponed reopen draws every card downstream grey with its status colour kept, and a rejected reopen draws the next hop red', async ({ page, baseURL }) => {
  const port = new URL(baseURL!).port
  // c depends_on b depends_on a, all under #werk, accepted and decided.
  werk(port, 'add', 'mk-a', '--title', 'Mark origin', '--parent', 'werk', '--who', 'me')
  werk(port, 'add', 'mk-b', '--title', 'One hop down', '--parent', 'werk', '--who', 'me')
  werk(port, 'add', 'mk-c', '--title', 'Two hops down', '--parent', 'werk', '--who', 'me')
  for (const id of ['mk-a', 'mk-b', 'mk-c']) werk(port, 'accept', id, '--actor', 'you')
  werk(port, 'link', 'mk-b', 'mk-a', '--type', 'depends_on')
  werk(port, 'link', 'mk-c', 'mk-b', '--type', 'depends_on')
  werk(port, 'edit', 'mk-a', '--no-basis', 'the origin of the marks')
  for (const id of ['mk-a', 'mk-b', 'mk-c']) {
    werk(port, 'kill', id, 'revisit at any time')
    werk(port, 'decide', id)
  }
  werk(port, 'reopen', 'mk-a', '--reason', 'postponed', '--why', 'not this month')

  await page.goto('/#werk')
  const subcards = page.getByRole('region', { name: 'sub-cards' })
  for (const title of ['One hop down', 'Two hops down']) {
    const row = subcards.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) })
    await expect(row).toHaveClass('paused')
    await expect(row.getByRole('link')).toHaveCSS('color', GREY)
    await expect(row.locator('.status')).toHaveText('decided')
    await expect(row.locator('.status')).toHaveCSS('color', GREEN)
    await expect(row.locator('.mark')).toHaveText('paused: postponed')
  }

  // A rejected reopen of b reaches c as well: stale wins on c, and a has no mark.
  werk(port, 'reopen', 'mk-b', '--reason', 'rejected', '--why', 'the plan is wrong')
  const c = subcards.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Two hops down', exact: true }) })
  await expect(c).toHaveClass('stale')
  await expect(c.locator('.mark')).toHaveText('stale: rejected')
  await expect(c.locator('.mark')).toHaveCSS('color', RED)

  await page.goto('/')
  const listing = page.getByRole('region', { name: 'staleness' })
  await expect(listing).toContainText('#mk-a reopened, postponed, on')
  await expect(listing).toContainText('over depends_on: not this month')
  await expect(listing).toContainText('#mk-b reopened, rejected, on')
  await expect(listing).toContainText('over depends_on: the plan is wrong')

  await page.goto('/#mk-c')
  await expect(page.getByRole('region', { name: 'stale' })).toContainText('#mk-b reopened, rejected')
  await expect(page.getByRole('region', { name: 'paused' })).toHaveCount(0)

  // Resuming the postponed card clears its paused marks; the stale mark stays.
  werk(port, 'decide', 'mk-a')
  await page.goto('/')
  await expect(listing).not.toContainText('postponed')
  await expect(listing).toContainText('#mk-b reopened, rejected')
})
