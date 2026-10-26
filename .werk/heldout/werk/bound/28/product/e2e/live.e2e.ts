import { spawnSync } from 'node:child_process'
import { CLI, testEnv } from '../test/env.ts'
import { fixtureProject } from './fixture.ts'
import { expect, test } from './test.ts'

/** Runs a werk command in the project the page shows, the way an agent writes the map. Playwright runs under Node, so it names bun. */
function werk(port: string, ...args: string[]): void {
  const result = spawnSync('bun', [CLI, ...args], { cwd: fixtureProject(port), env: testEnv(), encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`werk ${args.join(' ')} failed: ${result.stderr}`)
}

test('a card added from the command line appears in the open page without a reload, and a retitle shows only the new title', async ({ page, baseURL }) => {
  const port = new URL(baseURL!).port
  await page.goto('/#werk')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('werk v0')
  // A marker on the window object: a reload would drop it.
  await page.evaluate(() => Object.assign(window, { __sameDocument: true }))

  werk(port, 'add', 'werk-live', '--title', 'Drawn from the log', '--parent', 'werk')
  const subcards = page.getByRole('region', { name: 'sub-cards' })
  await expect(subcards.getByRole('link', { name: 'Drawn from the log' })).toBeVisible()

  werk(port, 'retitle', 'werk-live', 'Drawn from the fold of the log')
  await expect(subcards.getByRole('link', { name: 'Drawn from the fold of the log' })).toBeVisible()
  await expect(subcards.getByRole('link', { name: 'Drawn from the log', exact: true })).toHaveCount(0)

  expect(await page.evaluate(() => (window as { __sameDocument?: boolean }).__sameDocument)).toBe(true)
  await expect(page).toHaveURL(/#werk$/)
})

test('no control in the page can change a card: there is no field and no button', async ({ page }) => {
  for (const hash of ['', '#werk', '#werk-hmr', '#werk-hmr%3Asrc0']) {
    await page.goto(`/${hash}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('input, textarea, select, button, form, [contenteditable]')).toHaveCount(0)
  }
})
