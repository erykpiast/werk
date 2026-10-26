import { cpSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PRODUCT } from './lib.ts'
/** A full copy of the werk repository, with node_modules linked, outside the product tree. */
export function copyRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'heldout-werk-repo-')))
  cpSync(PRODUCT, dir, { recursive: true, filter: (src) => !/\/(node_modules|coverage|test-results|e2e\/evidence)(\/|$)/.test(src.slice(PRODUCT.length)) })
  symlinkSync(join(PRODUCT, 'node_modules'), join(dir, 'node_modules'))
  return dir
}
