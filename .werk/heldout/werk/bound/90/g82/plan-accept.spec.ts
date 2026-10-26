/** Held-out step 82.1, browser part: the person accepts each plan ghost one at a time with ✓. */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'
import type { Project } from '../../src/test/harness.ts'
import { GOOD_TICKETS, scriptWriters, seedMap } from './plan-helpers.ts'

const answer = (slug: string) => ({ slug, title: `Title ${slug}`, why: `Why ${slug}?`, body: `Body of ${slug}.` })

test('82.1 the person accepts each plan ghost one at a time with the ✓ button', async ({ page, werk }) => {
  seedMap({ dir: werk.dir } as Project)
  rmSync(join(werk.dir, '.werk', 'board.jsonl'), { force: true })
  scriptWriters(werk.scriptAgent as never, GOOD_TICKETS, { spec: [answer('token-ttl')], tickets: [answer('split-login')] })
  werk.cli(['plan', 'auth'])

  await page.goto(`${werk.url}#auth-token-ttl`)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-proposed', 'true')
  await expect(detail).toContainText('Title token-ttl')
  await page.getByRole('button', { name: 'Accept #auth-token-ttl' }).click()
  await expect(detail).toHaveAttribute('data-proposed', 'false')
  expect(werk.cli(['show', 'auth-split-login'])).toContain('state: ghost')

  await page.goto(`${werk.url}#auth-split-login`)
  await expect(detail).toHaveAttribute('data-proposed', 'true')
  await page.getByRole('button', { name: 'Accept #auth-split-login' }).click()
  await expect(detail).toHaveAttribute('data-proposed', 'false')
  expect(werk.cli(['show', 'auth-split-login'])).toContain('state: real')
})
