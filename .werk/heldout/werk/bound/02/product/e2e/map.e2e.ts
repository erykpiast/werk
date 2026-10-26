import { expect, test } from './test.ts'

test('the server renders the root page of the fixture map with React', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/')
  await expect(page.getByRole('main', { name: 'map' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('demo')
  const subcards = page.getByRole('region', { name: 'sub-cards' })
  await expect(subcards.getByRole('link', { name: 'werk v0' })).toBeVisible()
  // A source that a card is supported_by is that card's evidence, so it stays off the root.
  await expect(subcards).not.toContainText('Runtime research')
  await expect(subcards).not.toContainText('Keep node --watch')
  expect(errors).toEqual([])
})

test('opening a sub-card names it in the location hash, and a reload shows the same card', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('region', { name: 'sub-cards' }).getByRole('link', { name: 'werk v0' }).click()
  await expect(page).toHaveURL(/#werk$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('werk v0')

  await page.getByRole('region', { name: 'sub-cards' }).getByRole('link', { name: 'The dev server reloads its own modules' }).click()
  await expect(page).toHaveURL(/#werk-hmr$/)
  const detail = page.getByRole('region', { name: 'card detail' })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The dev server reloads its own modules')
  await expect(detail.getByRole('region', { name: 'said' })).toContainText('a restart kills my session every time I save')
  await expect(detail.getByRole('region', { name: 'said' })).toContainText('— Eryk')
  await expect(detail.getByRole('region', { name: 'evidence' }).getByRole('link', { name: 'Runtime research' })).toBeVisible()
  await expect(detail.getByRole('region', { name: 'options' })).toContainText('rejected: A restart kills in-flight agent children.')
  await expect(page.getByRole('region', { name: 'sub-cards' }).getByRole('link', { name: 'A guard on the global object keeps one server' })).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/#werk-hmr$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The dev server reloads its own modules')

  await page.goBack()
  await expect(page).toHaveURL(/#werk$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('werk v0')
})

test('a card id in the location hash opens that card: a leaf, with no sub-cards', async ({ page }) => {
  await page.goto('/#werk-hmr-guard')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A guard on the global object keeps one server')
  await expect(page.getByRole('navigation', { name: 'trail' })).toHaveText('demo / werk v0 / The dev server reloads its own modules')
  await expect(page.getByRole('region', { name: 'sub-cards' })).toHaveCount(0)
})

test('a source opens in the same page shape, by its id with a colon', async ({ page }) => {
  await page.goto('/#werk-hmr%3Asrc0')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Runtime research')
  await expect(page.getByRole('region', { name: 'card detail' })).toContainText('Bun --hot keeps the global object across reloads.')
  await expect(page.getByRole('region', { name: 'supports' })).toContainText('The dev server reloads its own modules')
})

test('the live channel opens from the page', async ({ page }) => {
  await page.goto('/')
  const hello = await page.evaluate(
    () =>
      new Promise<{ bootId: string; children: unknown[] }>((resolve) => {
        const source = new EventSource('/api/live')
        source.addEventListener('hello', (event) => {
          source.close()
          resolve(JSON.parse((event as MessageEvent).data))
        })
      }),
  )
  expect(hello.bootId).toMatch(/^[0-9a-f-]{36}$/)
  expect(hello.children).toEqual([])
})
