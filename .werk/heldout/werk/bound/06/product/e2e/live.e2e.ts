import { spawnSync } from 'node:child_process'
import { CLI, testEnv } from '../test/env.ts'
import { fixtureProject } from './fixture.ts'
import { expect, test } from './test.ts'

/** Runs a werk command in the project the page shows, the way an agent writes the map. Playwright runs under Node, so it names bun. */
function werk(port: string, ...args: string[]): void {
  const result = spawnSync('bun', [CLI, ...args], { cwd: fixtureProject(port), env: testEnv(), encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`werk ${args.join(' ')} failed: ${result.stderr}`)
}

test('a card added from the command line appears as a ghost in the open page without a reload; the ✓ makes it real, and a retitle shows only the new title', async ({ page, baseURL }) => {
  const port = new URL(baseURL!).port
  await page.goto('/#werk')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('werk v0')
  // A marker on the window object: a reload would drop it.
  await page.evaluate(() => Object.assign(window, { __sameDocument: true }))

  werk(port, 'add', 'werk-live', '--title', 'Drawn from the log', '--parent', 'werk')
  const subcards = page.getByRole('region', { name: 'sub-cards' })
  const ghost = subcards.getByRole('listitem').filter({ hasText: 'Drawn from the log' })
  await expect(ghost).toHaveClass('ghost')
  await expect(ghost).toHaveCSS('border-top-style', 'dashed')
  await expect(ghost).toContainText('proposed')

  await ghost.getByRole('button', { name: 'accept #werk-live' }).click()
  const real = subcards.getByRole('listitem').filter({ hasText: 'Drawn from the log' })
  await expect(real).not.toHaveClass('ghost')
  await expect(real.getByRole('button')).toHaveCount(0)

  werk(port, 'retitle', 'werk-live', 'Drawn from the fold of the log')
  await expect(subcards.getByRole('link', { name: 'Drawn from the fold of the log' })).toBeVisible()
  await expect(subcards.getByRole('link', { name: 'Drawn from the log', exact: true })).toHaveCount(0)

  expect(await page.evaluate(() => (window as { __sameDocument?: boolean }).__sameDocument)).toBe(true)
  await expect(page).toHaveURL(/#werk$/)
})

test('the ✓ on a ghost child whose parent is a ghost makes both real', async ({ page, baseURL }) => {
  const port = new URL(baseURL!).port
  werk(port, 'add', 'werk-ghost-parent', '--title', 'A proposed parent', '--parent', 'werk')
  werk(port, 'add', 'werk-ghost-child', '--title', 'A proposed child', '--parent', 'werk-ghost-parent')
  await page.goto('/#werk-ghost-parent')
  await expect(page.getByRole('region', { name: 'card detail' })).toHaveClass('detail ghost')
  const child = page.getByRole('region', { name: 'sub-cards' }).getByRole('listitem').filter({ hasText: 'A proposed child' })
  await expect(child).toHaveClass('ghost')

  await child.getByRole('button', { name: 'accept #werk-ghost-child' }).click()
  await expect(page.getByRole('region', { name: 'card detail' })).toHaveClass('detail')
  await expect(page.getByRole('region', { name: 'sub-cards' }).getByRole('listitem').filter({ hasText: 'A proposed child' })).not.toHaveClass('ghost')
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('no control in the page can change a card: there is no field and no button', async ({ page }) => {
  for (const hash of ['', '#werk', '#werk-hmr', '#werk-hmr%3Asrc0']) {
    await page.goto(`/${hash}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('input, textarea, select, button, form, [contenteditable]')).toHaveCount(0)
  }
})
