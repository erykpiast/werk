import { readFileSync } from 'node:fs'
const r = JSON.parse(readFileSync(process.argv[2] ?? 'heldout/results.json', 'utf8'))
const walk = (s: any): any[] => [...(s.specs ?? []), ...(s.suites ?? []).flatMap(walk)]
for (const spec of r.suites.flatMap(walk)) {
  for (const t of spec.tests) {
    const res = t.results.at(-1)
    const errs = (res.errors ?? []).map((e: any) => (e.message ?? '').replace(/\x1b\[[0-9;]*m/g, '').replace(/usage: werk[\s\S]*?\.werk\/log\.jsonl/g, '<usage>').slice(0, 900))
    console.log(`== ${spec.title}: ${res.status}`)
    for (const e of errs) console.log('   ' + e.split('\n').slice(0, 14).join('\n   '))
  }
}
