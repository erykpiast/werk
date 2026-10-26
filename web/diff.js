// A proposed change to a card's body, as a list of ops instead of a flat string.
// Shared by the server (src/fold.ts imports this) and the browser (app.js renders
// it), so both compute the same result from the same log. See #al-diff-cli.
//
// tag "elaborated": the same topic, reworded. old must quote a real block verbatim.
// tag "new": a block with no old counterpart.
// tag "removed": old must quote a real block verbatim; it drops from the body.

/** A body is a list of blocks, split the same way the Markdown renderer splits
 *  paragraphs — on a blank line. This is the unit a change is proposed against,
 *  not a sentence: a bullet list or a heading is one block, not many. */
export function splitBlocks(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    // Leading blank lines go, leading spaces stay: an indented first line is a code block.
    .map((s) => s.replace(/^\n+/, '').trimEnd())
    .filter((s) => s.trim())
}

/**
 * Every op that claims an `old` block must quote it verbatim. A claim that does not
 * match the real body is never trusted into an "elaborated" or "removed" tag — it is
 * demoted to a plain `new` (if it carried one) plus the real old block left as
 * `removed`. This is the whole point: a wrong claim can never silently mis-render.
 */
export function verifyOps(oldBody, ops) {
  const real = new Set(splitBlocks(oldBody))
  const verified = []
  const rejected = []
  for (const op of ops) {
    if ((op.tag === 'elaborated' || op.tag === 'removed') && !real.has(op.old)) {
      rejected.push({ op, reason: 'quote not found verbatim in the current body' })
      if (op.new) verified.push({ tag: 'new', new: op.new })
      if (op.old) verified.push({ tag: 'removed', old: op.old })
      continue
    }
    verified.push(op)
  }
  return { ops: verified, rejected }
}

/** The plain body text an accepted proposal commits, in the given op order. */
export function applyOps(ops) {
  return ops
    .filter((op) => op.tag !== 'removed')
    .map((op) => op.new)
    .join('\n\n')
}

/** A word run, a whitespace run, or one punctuation character — never a bare character
 *  of a word. A plain `.split(' ')` glues punctuation onto a word (`propose` vs
 *  `` `propose ``), so inserting one backtick reads as if the whole word changed. A
 *  plain character diff swings the other way: two different words that share letters
 *  ("button" / "CTA") come out as a letter-salad instead of one clean substitution. */
function tokenize(s) {
  return s.match(/\w+|\s+|[^\w\s]/g) || []
}

/** LCS diff over tokens, returned as same/del/add — not yet marked up, so the caller
 *  decides how much of a matched run to keep outside the highlight. */
function wordTokens(a, b) {
  const aw = tokenize(a), bw = tokenize(b)
  const dp = Array.from({ length: aw.length + 1 }, () => new Array(bw.length + 1).fill(0))
  for (let i = aw.length - 1; i >= 0; i--)
    for (let j = bw.length - 1; j >= 0; j--)
      dp[i][j] = aw[i] === bw[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  let i = 0, j = 0
  const tokens = []
  while (i < aw.length && j < bw.length) {
    if (aw[i] === bw[j]) { tokens.push({ type: 'same', text: aw[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { tokens.push({ type: 'del', text: aw[i] }); i++ }
    else { tokens.push({ type: 'add', text: bw[j] }); j++ }
  }
  while (i < aw.length) tokens.push({ type: 'del', text: aw[i++] })
  while (j < bw.length) tokens.push({ type: 'add', text: bw[j++] })
  return tokens
}

/** Only a changed run gets the `==mark==` highlight — matched words on either side
 *  stay plain, so a scan finds the change instead of a whole re-highlighted sentence.
 *  But a rewrite of a whole passage still shares short, common words (`is`, `the`, `a`)
 *  with the original, scattered at whatever positions the LCS finds them. A match that
 *  is not at least two words long, with a change on both sides of it, is one of those
 *  coincidences, not a real anchor — it stays inside the one block instead of splitting
 *  a rewrite into word-for-word salad. */
function wordDiffMarkdown(a, b) {
  const tokens = wordTokens(a, b)

  const runs = []
  for (const t of tokens) {
    const last = runs[runs.length - 1]
    if (last && last.type === t.type) last.tokens.push(t)
    else runs.push({ type: t.type, tokens: [t] })
  }
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    if (r.type !== 'same') continue
    const wordCount = r.tokens.filter((t) => /\w/.test(t.text)).length
    r.connective = wordCount <= 1 && i > 0 && i < runs.length - 1
  }

  const out = []
  let run = []
  const flush = () => {
    if (run.length === 0) return
    // Render old-then-new, not the interleaved LCS order: a run built from several
    // del/add pairs in a row is one rewritten phrase, and reads as one only if the
    // whole old wording comes first (struck through) and the whole new wording
    // follows — alternating word-by-word is the salad this block exists to avoid.
    const oldRaw = run.filter((t) => t.type !== 'add').map((t) => t.text).join('')
    const newRaw = run.filter((t) => t.type !== 'del').map((t) => t.text).join('')
    const oldText = oldRaw.trim()
    const newText = newRaw.trim()
    run = []
    if (!oldText && !newText) return
    // `==mark==` and `~~del~~` only parse when the character just inside each
    // delimiter is not a space (web/md.js requires it): oldRaw/newRaw can each carry a
    // stray leading or trailing space (a shared connective the LCS placed at the edge
    // of this run), so that space is pulled out here and placed outside the delimiters.
    const lead = oldText ? oldRaw.match(/^\s*/)[0] : newRaw.match(/^\s*/)[0]
    const trail = newText ? newRaw.match(/\s*$/)[0] : oldRaw.match(/\s*$/)[0]
    const mid = oldText && newText ? oldRaw.match(/\s*$/)[0] || newRaw.match(/^\s*/)[0] : ''
    const del = oldText ? `~~${oldText}~~` : ''
    out.push(`${lead}==${del}${mid}${newText}==${trail}`)
  }
  for (const r of runs) {
    if (r.type === 'same' && !r.connective) {
      flush()
      for (const t of r.tokens) out.push(t.text)
    } else {
      run.push(...r.tokens)
    }
  }
  flush()
  return out.join('')
}

/** A heading, list, or quote line. `==mark==`/`~~del~~` are inline rules — the Markdown
 *  renderer resolves them only inside one paragraph or list item, never across a
 *  paragraph/list boundary. A block built from one of these cannot be safely wrapped in
 *  either, so it renders plain instead, labelled, rather than silently breaking. */
function isStructural(text) {
  return /(^|\n)\s*([-*+>]\s|#{1,6}\s|\d+[.)]\s)/.test(text)
}

/** The bullet, number, or quote mark a line opens with — empty for plain prose. Two
 *  lines only line up as "the same list item, reworded" if this matches; otherwise a
 *  word diff could swallow the marker itself and the line would stop parsing as a
 *  list item at all. */
function leadingMarker(line) {
  return line.match(/^\s*(?:[-*+>]|\d+[.)])?\s*/)[0]
}

/** A bullet or numbered list: its first line opens with a list marker. */
function isList(text) {
  return /^\s*(?:[-*+]|\d+[.)])\s/.test(text)
}

/** Share of words two lines have in common, 0 to 1 — enough to tell a reworded item from an unrelated one. */
function similarity(a, b) {
  const words = (s) => tokenize(s).filter((t) => /\w/.test(t)).length
  const same = wordTokens(a, b).filter((t) => t.type === 'same' && /\w/.test(t.text)).length
  return same / Math.max(words(a), words(b), 1)
}

/** A list that gained, lost, or reworded items. An LCS over the item text (marker aside, so
 *  a renumbered item still matches) keeps every unchanged item plain. Between two unchanged
 *  items, an old item pairs with a later new item only if the two share at least half their
 *  words — a reworded item, word-diffed in place. Anything left over is one removed or one
 *  added item, marked alone: one new bullet never strikes out the whole list. */
function renderListDiff(oldLines, newLines) {
  const text = (l) => l.slice(leadingMarker(l).length)
  // A number is a number whatever its value: `2.` and `3.` are the same kind of marker.
  const kind = (l) => leadingMarker(l).replace(/\d+/, '1')
  const reworded = (o, n) => kind(o) === kind(n) && similarity(text(o), text(n)) >= 0.5
  const a = oldLines.map(text), b = newLines.map(text)
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  const out = []
  let gapOld = [], gapNew = []
  const flushGap = () => {
    let j = 0
    for (const o of gapOld) {
      let k = j
      while (k < gapNew.length && !reworded(o, gapNew[k])) k++
      if (k === gapNew.length) { out.push(markBlock(o, true)); continue }
      for (; j < k; j++) out.push(markBlock(gapNew[j], false))
      out.push(leadingMarker(gapNew[k]) + wordDiffMarkdown(text(o), text(gapNew[k])))
      j = k + 1
    }
    for (; j < gapNew.length; j++) out.push(markBlock(gapNew[j], false))
    gapOld = []
    gapNew = []
  }
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { flushGap(); out.push(newLines[j]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) gapOld.push(oldLines[i++])
    else gapNew.push(newLines[j++])
  }
  while (i < a.length) gapOld.push(oldLines[i++])
  while (j < b.length) gapNew.push(newLines[j++])
  flushGap()
  return out.join('\n')
}

/** A multi-line block — a list, mainly — diffed one line at a time instead of as one
 *  blob. Diffing the whole block as one string lets the LCS match a marker from one
 *  item (`3.`) against an unrelated one further down, tangling item boundaries
 *  together; a per-line diff can't cross that boundary because it never sees it. */
function renderElaborated(oldText, newText) {
  if (oldText === newText) return newText
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const sameShape =
    oldLines.length > 1 &&
    oldLines.length === newLines.length &&
    oldLines.every((l, i) => leadingMarker(l) === leadingMarker(newLines[i]))
  // A list goes first: one item out and one in keeps the line count, but pairing by
  // position would then mark every item after the removed one.
  if (isList(oldText) && isList(newText)) return renderListDiff(oldLines, newLines)
  if (sameShape) return oldLines.map((l, i) => wordDiffMarkdown(l, newLines[i])).join('\n')
  if (isStructural(oldText) || isStructural(newText)) {
    // The kind changed, so no line pairs up with another: the old block goes out, the new one comes in.
    return `${markBlock(oldText, true)}\n\n${markBlock(newText, false)}`
  }
  return wordDiffMarkdown(oldText, newText)
}

/** The proposed change, rendered as Markdown the map already knows how to show. */
export function renderOpsMarkdown(ops) {
  return ops
    .map((op) => {
      if (op.tag === 'elaborated') return renderElaborated(op.old, op.new)
      if (op.tag === 'new') return markBlock(op.new, false)
      return markBlock(op.old, true)
    })
    .join('\n\n')
}

/** A whole added block gets the background; a whole removed block gets the background and
 *  a strikethrough. No `+` or label in front. A list or heading is marked line by line,
 *  after its own marker, because `==` only resolves inside one paragraph or list item. */
function markBlock(text, removed) {
  const wrap = (s) => (removed ? `==~~${s}~~==` : `==${s}==`)
  // A fenced code block is not inline text: the marks cannot wrap it, so it shows as it is.
  if (/^\s*```/.test(text)) return text
  if (!isStructural(text)) return wrap(text)
  return text
    .split('\n')
    .map((line) => {
      const m = line.match(/^(\s*(?:[-*+>]|#{1,6}|\d+[.)])\s+)(\S.*)$/)
      return m ? m[1] + wrap(m[2]) : line.trim() ? wrap(line.trim()) : line
    })
    .join('\n')
}

/** A changed title or why line, as one inline diff. A single line, so the same word diff
 *  as a paragraph; the caller renders it with the Markdown the map already knows. */
export function renderInlineDiff(oldText, newText) {
  if (oldText === newText) return newText
  // `==` and `~~` do not cross a paragraph break. Paragraphs that pair up one to one are
  // diffed in pairs; otherwise the old paragraphs go out and the new ones come in.
  const a = oldText.split(/\n\s*\n/)
  const b = newText.split(/\n\s*\n/)
  if (a.length === 1 && b.length === 1) return wordDiffMarkdown(oldText, newText)
  if (a.length === b.length) return a.map((p, i) => renderInlineDiff(p, b[i])).join('\n\n')
  return [...a.map((p) => markBlock(p, true)), ...b.map((p) => markBlock(p, false))].join('\n\n')
}
