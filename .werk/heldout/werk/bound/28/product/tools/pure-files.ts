/**
 * The pure files: no I/O, so a coverage number means something for them. The coverage gate
 * holds each one to THRESHOLD percent of lines. An I/O module is not listed here; its tests
 * name its behaviours instead (#werk-test-scope).
 */
export const THRESHOLD = 90

export const PURE_FILES: readonly string[] = [
  'src/args.ts',
  'src/client/route.ts',
  'src/map/events.ts',
  'src/map/fold.ts',
  'src/map/view.ts',
  'src/server/local.ts',
  'src/server/sse.ts',
  'tools/coverage.ts',
]
