#!/usr/bin/env bun
// The whole grid pipeline on one file: parse, check, resolve, render.
// Usage: bun src/gridsys/build.ts .werk/diagram-grid.wgrid .werk/diagram-grid.svg [--tracks] [--columns]
//
// A failed check writes nothing. The router pipeline can warn and still emit a diagram that
// is merely ugly; a broken tile grammar has no reading at all, so an SVG here would be a
// guess dressed up as a result.
import { check } from './check.ts'
import { parseGrid } from './parse.ts'
import { render } from './render.ts'
import { resolveGrid } from './resolve.ts'

const args = process.argv.slice(2)
const showTracks = args.includes('--tracks')
const debugColumns = args.includes('--columns')
const [inPath, outPath] = args.filter((a) => !a.startsWith('--'))
if (!inPath || !outPath) {
  console.error('usage: bun src/gridsys/build.ts <in.wgrid> <out.svg> [--tracks] [--columns]')
  process.exit(1)
}

const doc = parseGrid(await Bun.file(inPath).text())
const { errors, index } = check(doc)

if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`)
  console.error(`${errors.length} error(s) — ${outPath} not written`)
  process.exit(1)
}

const resolved = resolveGrid(doc, index)
await Bun.write(outPath, render(resolved, debugColumns))

const r1 = (n: number) => Math.round(n * 10) / 10
console.log(`wrote ${outPath} (${resolved.width}x${resolved.height}), 0 error(s)`)
for (const w of resolved.warnings) console.log(`warning: ${w}`)
if (showTracks) {
  console.log(`colW: [${resolved.colW.map(r1).join(', ')}]`)
  console.log(`rowH: [${resolved.rowH.map(r1).join(', ')}]`)
}
