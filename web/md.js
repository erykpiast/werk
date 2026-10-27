// A small Markdown renderer. The project has no dependencies and this needs to stay small.
// It covers what an agent actually writes: fenced code, inline code, bold, italic, links,
// headings, lists, block quotes, horizontal rules, tables, and references to other cards.

/** #werk-progress-safe-links: a link or image address renders only when it starts with http:,
 *  https:, mailto:, a slash, a hash or a dot. Anything else stays as its written text. */
const SAFE_URL = /^(?:https?:|mailto:|[/#.])/i

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** The marker that holds a code span's place. A null byte cannot occur in the text. */
const MARK = String.fromCharCode(0)
/** Same idea, for a `==mark==` span. A separate character so the two stashes never collide. */
const MARK2 = String.fromCharCode(1)
/** Same idea, for a finished image or link tag: an id inside its URL is not a reference. */
const MARK3 = String.fromCharCode(2)

/**
 * Turn `#card-id` into a link to that card. A bare `card-id` (no `#`) links too, as long as it
 * has a hyphen or a colon — that shape never occurs in ordinary prose, so `al-diff` links but
 * `align` does not, and a sentence about "the loop" is never mistaken for a reference.
 *
 * `knows` decides what is a card. A dead reference and a plain `#` in prose stay text, so
 * a link always goes somewhere. The href is the hash route the map already uses, which is
 * why a click needs no handler.
 *
 * Use this on text that is already HTML-escaped.
 */
/** #werk-mc-nextbtn: the phrase of a suggested next action, from the last line of an agent
 *  message, or null. The pane makes it a button; the Flow tab counts it as a hanging
 *  question (#ms-outcome-interv-chat-q), so both read the same rule. */
export function nextPhrase(text) {
  const last = (text ?? '').trimEnd().split('\n').pop() ?? ''
  return last.match(/^[*_]*Next:[*_]*\s+(?:say|reply)\s+["“]([^"”\n]+)["”]/i)?.[1].trim() || null
}

/** The open project's address prefix, `/p/<name>` (#vi-routes). The page sets it once. */
let cardBase = ''
export const setCardBase = (base) => {
  cardBase = base
}
/** #vi-home-howwhat: the home, the bare map address, which shows the two top cards side by
 *  side. It stands where a card id goes. No card can have it as its id: an id never holds `~`. */
export const HOME = '~home'
/** The two top cards of every map, the same ids as the server's (src/tops.ts). */
export const WHAT = 'what'
export const HOW = 'how'
/** A card's address on the map (#vi-routes). Every card link uses it, so no link is a hash.
 *  An id is letters, digits, `-`, `_` and `:`, all safe in a path as they are. A link stays
 *  in the current project. */
export const cardHref = (id) => (id === HOME ? `${cardBase}/map` : `${cardBase}/map/${id}`)
/** The card a link points at, the home for the bare map address, or null when the link is not
 *  a map address. */
export function cardOfHref(href) {
  const m = /^(?:\/p\/[^/]+)?\/map(?:\/([^/?#]+))?$/.exec(href ?? '')
  return m ? (m[1] ? decodeURIComponent(m[1]) : HOME) : null
}

export function cardLinks(html, knows) {
  if (!knows) return html
  // The character before must not be a word character, a slash, or another `#`, so a URL
  // fragment and a colour like #fff are left alone. An id always starts with a letter.
  // A hyphen, a colon or an ampersand joins the text to the token before it (#werk-reflink-guard).
  // The text is escaped, so a written `&` arrives as `&amp;`: the lookbehind treats it as one `&`.
  return html.replace(/(^|[^\w&/#:-])(?<!&amp;)(#)?([a-z][\w-]*(?::[\w-]+)?)/gi, (whole, before, hash, id) => {
    if (!hash && !/[-:]/.test(id)) return whole
    // #werk-reflink-trailing-punct: drop a trailing `-`, `_`, `:` or `.` one at a time until
    // the rest names a known id. The dropped characters stay as text after the link.
    let head = id
    while (head && !knows(head) && /[-_:.]$/.test(head)) head = head.slice(0, -1)
    if (!head || !knows(head)) return whole
    return `${before}<a class="ref" href="${cardHref(head)}">#${head}</a>${id.slice(head.length)}`
  })
}

/** Inline rules. The text is already HTML-escaped when this runs. With `links` off, a link
 *  and an image render as their text, for text that sits inside a link already. */
function inline(s, knows, links = true) {
  // Stash a ==mark== span first, and resolve what's inside it as its own self-contained
  // unit (a recursive call). Otherwise a lone backtick inserted by a diff (see #al-diff-cli)
  // pairs with an unrelated backtick elsewhere in the same paragraph — the code-span rule
  // below matches from any backtick to the next one in the whole string, with no idea a
  // mark boundary sits between them, and swallows the == markers as literal text.
  const marks = []
  const destashed = s.replace(
    /==(?=\S)([\s\S]*?\S)==/g,
    (_, inner) => `${MARK2}${marks.push(`<mark>${inline(inner, knows, links)}</mark>`) - 1}${MARK2}`,
  )

  // Stash code spans next. Nothing inside one is markup, and nothing inside one is a card
  // reference either: `#rollup` inside a command is part of the command.
  const spans = []
  // A span opens and closes with the same run of backticks, so ```` ```ts ```` holds a fence
  // opener. One space on each side of the content is padding, as in CommonMark.
  const stashed = destashed.replace(/(?<!`)(`+)(?!`)([^\n]*?[^`\n]|[^`\n])\1(?!`)/g, (_, _ticks, code) => {
    const trimmed = /^ .* $/.test(code) && code.trim() ? code.slice(1, -1) : code
    return `${MARK}${spans.push(trimmed) - 1}${MARK}`
  })
  const tags = []
  const tag = (html) => `${MARK3}${tags.push(html) - 1}${MARK3}`
  const marked = stashed
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt, src) =>
      !SAFE_URL.test(src) ? whole : links ? tag(`<img src="${src}" alt="${alt}" loading="lazy">`) : alt,
    )
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text, href) =>
      !SAFE_URL.test(href) ? whole : links ? tag(`<a href="${href}"${/^https?:|^mailto:/i.test(href) ? ' target="_blank" rel="noreferrer"' : ''}>${text}</a>`) : text,
    )
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
  return cardLinks(marked, knows)
    .replace(new RegExp(`${MARK3}(\\d+)${MARK3}`, 'g'), (_, i) => tags[i])
    .replace(new RegExp(`${MARK}(\\d+)${MARK}`, 'g'), (_, i) => codeSpan(spans[i], knows))
    .replace(new RegExp(`${MARK2}(\\d+)${MARK2}`, 'g'), (_, i) => marks[i])
}

/**
 * A code span that is nothing but a card reference — `` `#al-diff` `` or `` `al-diff` `` —
 * renders as the same link plain-text `#al-diff` gets, so every way of writing a reference
 * looks and behaves the same. Anything else in the span stays literal code.
 */
function codeSpan(code, knows) {
  const id = code.trim().match(/^#?([a-z][\w-]*(?::[\w-]+)?)$/i)?.[1]
  if (knows && id && knows(id)) return `<a class="ref" href="${cardHref(id)}">#${id}</a>`
  return `<code>${code}</code>`
}

/** `| a | b |` -> ['a', 'b']. A `\|` is a literal bar inside a cell, not a separator. */
function cells(line) {
  const row = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return row
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

/** The `|---|:--:|` line under a table's head. It also carries the column alignment. */
function alignments(line) {
  if (!/\|/.test(line) || !/^[\s|:-]+$/.test(line)) return null
  const marks = cells(line)
  if (marks.length === 0 || !marks.every((m) => /^:?-{1,}:?$/.test(m))) return null
  return marks.map((m) => (m.startsWith(':') && m.endsWith(':') ? 'center' : m.endsWith(':') ? 'right' : ''))
}

/** Group the lines of one non-code segment into blocks. */
function blocks(text, knows) {
  const lines = text.split('\n')
  const out = []
  let list = null // { tag, items: [] }

  const closeList = () => {
    if (!list) return
    out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i, knows)}</li>`).join('')}</${list.tag}>`)
    list = null
  }

  let paragraph = []
  const closeParagraph = () => {
    if (paragraph.length === 0) return
    out.push(`<p>${inline(paragraph.join('\n'), knows)}</p>`)
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    // The text is already HTML-escaped here, so a quote marker arrives as &gt;.
    const quote = line.match(/^&gt;\s?(.*)$/)

    // A table is a head row, a `|---|` line, then rows until a line with no bar. The
    // separator is what makes it a table: one line with a bar in it is still prose.
    const align = line.includes('|') ? alignments(lines[i + 1] ?? '') : null
    if (align) {
      closeParagraph()
      closeList()
      const head = cells(line)
      const rows = []
      let r = i + 2
      while (r < lines.length && lines[r].includes('|') && lines[r].trim() !== '') {
        rows.push(cells(lines[r]))
        r++
      }
      i = r - 1
      const cell = (tag, text, n) => {
        const style = align[n] ? ` style="text-align:${align[n]}"` : ''
        return `<${tag}${style}>${inline(text ?? '', knows)}</${tag}>`
      }
      out.push(
        `<table><thead><tr>${head.map((h, n) => cell('th', h, n)).join('')}</tr></thead>` +
          `<tbody>${rows
            .map((row) => `<tr>${head.map((_, n) => cell('td', row[n], n)).join('')}</tr>`)
            .join('')}</tbody></table>`,
      )
      continue
    }

    if (line.trim() === '') {
      closeParagraph()
      closeList()
      continue
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      closeParagraph()
      closeList()
      out.push('<hr>')
      continue
    }
    if (heading) {
      closeParagraph()
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2], knows)}</h${level}>`)
      continue
    }
    if (bullet || numbered) {
      closeParagraph()
      const tag = bullet ? 'ul' : 'ol'
      if (!list || list.tag !== tag) {
        closeList()
        list = { tag, items: [] }
      }
      list.items.push((bullet ?? numbered)[1])
      continue
    }
    if (quote) {
      closeParagraph()
      closeList()
      out.push(`<blockquote>${inline(quote[1], knows)}</blockquote>`)
      continue
    }
    closeList()
    paragraph.push(line)
  }
  closeParagraph()
  closeList()
  return out.join('')
}

/**
 * One regex per language, in named groups. Only the languages a card body actually quotes —
 * a wire message, a snippet, a shell line. An unlisted language is escaped and left plain:
 * a missing grammar must never break rendering.
 */
const GRAMMARS = {
  json: /(?<prop>"(?:[^"\\]|\\.)*"(?=\s*:))|(?<str>"(?:[^"\\]|\\.)*")|(?<num>-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(?<bool>\b(?:true|false|null)\b)|(?<punct>[{}[\]:,])/g,
  js: /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<str>`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<num>-?\b\d+(?:\.\d+)?\b)|(?<kw>\b(?:const|let|var|function|return|if|else|for|while|new|class|extends|import|from|export|default|async|await|typeof|instanceof|in|of|try|catch|finally|throw|switch|case|break|continue|this|null|undefined|true|false|interface|type|as|implements|public|private|readonly|void|never)\b)/g,
  bash: /(?<comment>#[^\n]*)|(?<str>"(?:[^"\\]|\\.)*"|'[^']*')|(?<flag>(?<![\w-])--?[A-Za-z][\w-]*)|(?<kw>\b(?:if|then|else|elif|fi|for|do|done|while|case|esac|function|return|export|local|in)\b)/g,
}
GRAMMARS.jsonc = GRAMMARS.json
GRAMMARS.ts = GRAMMARS.tsx = GRAMMARS.jsx = GRAMMARS.javascript = GRAMMARS.typescript = GRAMMARS.js
GRAMMARS.sh = GRAMMARS.shell = GRAMMARS.zsh = GRAMMARS.bash

/** Escape `code`, wrapping each token GRAMMARS[lang] finds in a `<span class="tok-*">`. */
function highlight(code, lang) {
  // Own keys only: a tag like `constructor` must not find an inherited property.
  const key = lang.toLowerCase()
  if (!Object.hasOwn(GRAMMARS, key)) return esc(code)
  const grammar = GRAMMARS[key]
  let out = ''
  let last = 0
  for (const m of code.matchAll(grammar)) {
    out += esc(code.slice(last, m.index))
    const cls = Object.keys(m.groups).find((k) => m.groups[k] !== undefined)
    out += `<span class="tok-${cls}">${esc(m[0])}</span>`
    last = m.index + m[0].length
  }
  return out + esc(code.slice(last))
}

/**
 * Render Markdown to HTML.
 * Fenced code is split out first so no inline rule ever runs inside a code block.
 * A trailing unclosed fence still renders, which matters while a reply streams in.
 * `knows(id)` is optional: pass it to turn `#card-id` into a link.
 */
/** One line of inline Markdown for text inside a link, such as the why line of a sub-card
 *  tile: no paragraph, no links, no card references. See #vi-onview-subcards. */
export function mdInline(text) {
  return inline(esc(text), null, false)
}

export function md(text, knows) {
  // A fence opens and closes only on a line of its own, as in CommonMark: three backticks
  // in the middle of a sentence are prose. The closer is at least as long as the opener.
  const lines = String(text ?? '').split('\n')
  const out = []
  let prose = []
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^ {0,3}(`{3,})([^`]*)$/)
    if (!open) {
      prose.push(lines[i])
      continue
    }
    out.push(blocks(esc(prose.join('\n')), knows))
    prose = []
    let end = i + 1
    while (end < lines.length) {
      const close = lines[end].match(/^ {0,3}(`{3,})\s*$/)
      if (close && close[1].length >= open[1].length) break
      end++
    }
    // The tag is the first word of the info string: ```ts title=x is a ts fence.
    const lang = open[2].trim().split(/\s+/)[0]
    const code = lines.slice(i + 1, end).join('\n')
    out.push(`<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${highlight(code, lang)}</code></pre>`)
    i = end
  }
  out.push(blocks(esc(prose.join('\n')), knows))
  return out.join('')
}
