import { test } from '@playwright/test'
import { Project, serve, type Served } from './helpers.ts'

export const ctx: { p?: Project; s?: Served } = {}
test.afterEach(async () => {
  await ctx.s?.stop()
  ctx.p?.cleanup()
  ctx.p = ctx.s = undefined
})
export async function setup(fn?: (p: Project) => void): Promise<{ p: Project; s: Served }> {
  const p = (ctx.p = new Project())
  fn?.(p)
  const s = (ctx.s = await serve(p.dir))
  return { p, s }
}
export { Project, serve }
