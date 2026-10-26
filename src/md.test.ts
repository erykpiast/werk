// web/md.js renders every card body and every chat reply. A wrong rule here renders a wrong
// body that still looks like a body, so it is pure code under the 90% gate.
import { describe, expect, test } from 'bun:test'
import { cardLinks, md, mdInline, nextPhrase } from '../web/md.js'

const knows = (id: string) => ['al-diff', 'werk-test', 'x:opt0'].includes(id)

describe('mdInline: one line inside a link (#vi-onview-subcards)', () => {
  test('renders inline markup with no paragraph around it', () => {
    expect(mdInline('**b** *i* ~~d~~ `c`')).toBe('<strong>b</strong> <em>i</em> <del>d</del> <code>c</code>')
  })

  test('a link renders as its text, and a reference stays plain text', () => {
    expect(mdInline('see [docs](https://x.y) and #al-diff')).toBe('see docs and #al-diff')
  })

  test('a code span that holds only an id stays code, not a link', () => {
    expect(mdInline('`al-diff`')).toBe('<code>al-diff</code>')
  })

  test('an image renders as its alt text', () => {
    expect(mdInline('![a chart](p.png)')).toBe('a chart')
  })

  test('escapes HTML', () => {
    expect(mdInline('<b> & `<i>`')).toBe('&lt;b&gt; &amp; <code>&lt;i&gt;</code>')
  })
})

describe('md: inline rules', () => {
  test('bold, italic, strike, mark, code, links and images', () => {
    expect(md('**b** *i* ~~d~~ ==m== `c` [l](https://x.y) ![a](p.png)')).toBe(
      '<p><strong>b</strong> <em>i</em> <del>d</del> <mark>m</mark> <code>c</code> ' +
        '<a href="https://x.y" target="_blank" rel="noreferrer">l</a> <img src="p.png" alt="a" loading="lazy"></p>',
    )
  })

  test('a card id inside an image or link URL stays part of the URL', () => {
    expect(md('![al-diff](/api/image?name=al-diff.png) [x](https://h/werk-test)', knows)).toBe(
      '<p><img src="/api/image?name=al-diff.png" alt="al-diff" loading="lazy"> ' +
        '<a href="https://h/werk-test" target="_blank" rel="noreferrer">x</a></p>',
    )
  })

  test('a code span inside a mark stays inside it', () => {
    expect(md('==mark `a` b== `c`')).toBe('<p><mark>mark <code>a</code> b</mark> <code>c</code></p>')
  })

  test('HTML in the text is escaped, never injected', () => {
    expect(md('<script>x</script> & "q"')).toBe('<p>&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;</p>')
  })

  test('null renders as nothing', () => {
    expect(md(null)).toBe('')
  })
})

describe('md: card references', () => {
  test('a known #id and a bare hyphenated id link to the card; a dead one stays text', () => {
    expect(md('see #al-diff and werk-test, x:opt0, #unknown-id', knows)).toBe(
      '<p>see <a class="ref" href="/map/al-diff">#al-diff</a> and <a class="ref" href="/map/werk-test">#werk-test</a>, ' +
        '<a class="ref" href="/map/x:opt0">#x:opt0</a>, #unknown-id</p>',
    )
  })

  test('a colour, a URL fragment and a plain word are not references', () => {
    expect(md('#fff http://a/#al-diff align', knows)).toBe('<p>#fff http://a/#al-diff align</p>')
  })

  test('an id inside a longer token stays text: after a hyphen, a second #, a colon or an ampersand', () => {
    expect(md('--al-diff ##al-diff y:al-diff &al-diff', knows)).toBe('<p>--al-diff ##al-diff y:al-diff &amp;al-diff</p>')
    expect(md('see #al-diff, "al-diff" <al-diff>', knows)).toBe(
      '<p>see <a class="ref" href="/map/al-diff">#al-diff</a>, &quot;<a class="ref" href="/map/al-diff">#al-diff</a>&quot; ' +
        '&lt;<a class="ref" href="/map/al-diff">#al-diff</a>&gt;</p>',
    )
  })

  test('a code span that is only a reference renders as the link; any other code stays code', () => {
    expect(md('`#al-diff` `al-diff` `#rollup x`', knows)).toBe(
      '<p><a class="ref" href="/map/al-diff">#al-diff</a> <a class="ref" href="/map/al-diff">#al-diff</a> <code>#rollup x</code></p>',
    )
  })

  test('without knows, nothing links', () => {
    expect(cardLinks('#al-diff', undefined)).toBe('#al-diff')
    expect(md('`#al-diff`')).toBe('<p><code>#al-diff</code></p>')
  })
})

describe('md: blocks', () => {
  test('headings, bullet and numbered lists, rules and paragraphs', () => {
    expect(md('## H\n- a\n* b\n1. c\n2) d\n\n---\n\none\ntwo')).toBe(
      '<h2>H</h2><ul><li>a</li><li>b</li></ul><ol><li>c</li><li>d</li></ol><hr><p>one\ntwo</p>',
    )
  })

  // web/md.js escapes the text before it splits blocks, so a quote line reaches the `^>`
  // rule as `&gt; q` and never matches. A block quote renders as a paragraph with a
  // literal "> ". Reported, not fixed here: this harness does not change product code.
  test('a quote line renders as a block quote', () => {
    expect(md('> q')).toBe('<blockquote>q</blockquote>')
  })

  test('a table needs its separator line, and keeps column alignment and escaped bars', () => {
    expect(md('| a | b \\| c | d |\n|:--|:-:|--:|\n| 1 | 2 |\nafter')).toBe(
      '<table><thead><tr><th>a</th><th style="text-align:center">b | c</th><th style="text-align:right">d</th></tr></thead>' +
        '<tbody><tr><td>1</td><td style="text-align:center">2</td><td style="text-align:right"></td></tr></tbody></table>' +
        '<p>after</p>',
    )
  })

  test('one line with a bar and no separator is still prose', () => {
    expect(md('one | two\n|x|y|')).toBe('<p>one | two\n|x|y|</p>')
  })
})

describe('md: fenced code', () => {
  test('json, ts and bash tokens get a class; an unknown or missing language is plain', () => {
    const out = md('```json\n{"a": 1, "b": true}\n```\n```ts\nconst x = 1 // c\n```\n```bash\nls -la "x" # c\n```\n```\n<b>\n```\n```nope\nz\n```')
    expect(out).toContain('<span class="tok-prop">&quot;a&quot;</span>')
    expect(out).toContain('<span class="tok-bool">true</span>')
    expect(out).toContain('<span class="tok-kw">const</span>')
    expect(out).toContain('<span class="tok-comment">// c</span>')
    expect(out).toContain('<span class="tok-flag">-la</span>')
    expect(out).toContain('<pre><code>&lt;b&gt;</code></pre>')
    expect(out).toContain('<pre data-lang="nope"><code>z</code></pre>')
  })

  test('a tag picks its grammar by any common name, in any letter case', () => {
    for (const tag of ['sh', 'Shell', 'ZSH']) expect(md(`\`\`\`${tag}\nls -la\n\`\`\``)).toContain('<span class="tok-flag">-la</span>')
    for (const tag of ['tsx', 'TypeScript']) expect(md(`\`\`\`${tag}\nconst x\n\`\`\``)).toContain('<span class="tok-kw">const</span>')
    expect(md('```jsonc\n{"a": 1}\n```')).toContain('<span class="tok-prop">&quot;a&quot;</span>')
  })

  test('the tag is the first word of the info string', () => {
    expect(md('```ts title=x\nconst y\n```')).toBe('<pre data-lang="ts"><code><span class="tok-kw">const</span> y</code></pre>')
  })

  test('three backticks inside a line are prose, not a fence', () => {
    expect(md('A fence like ```` ```ts title=x ````, gets colours.\n\nNext.')).toBe(
      '<p>A fence like <code>```ts title=x</code>, gets colours.</p><p>Next.</p>',
    )
    expect(md('Write `` a`b `` here')).toBe('<p>Write <code>a`b</code> here</p>')
  })

  test('a fence closes only on a backtick line at least as long as its opener', () => {
    expect(md('````md\n```\ninner\n```\n````\nafter')).toBe(
      '<pre data-lang="md"><code>```\ninner\n```</code></pre><p>after</p>',
    )
  })

  test('a tag that names an object property renders plain, with its label', () => {
    for (const tag of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
      expect(md(`\`\`\`${tag}\na <b>\n\`\`\``)).toBe(`<pre data-lang="${tag}"><code>a &lt;b&gt;</code></pre>`)
  })

  test('no inline rule runs inside a code block', () => {
    expect(md('```\n**not bold** #al-diff\n```', knows)).toBe('<pre><code>**not bold** #al-diff</code></pre>')
  })

  test('an unclosed fence still renders while a reply streams in', () => {
    expect(md('text\n```js\nopen')).toBe('<p>text</p><pre data-lang="js"><code>open</code></pre>')
  })
})

describe('nextPhrase (#werk-mc-nextbtn)', () => {
  test('reads the phrase from a Next: say or reply line at the end, and nothing else', () => {
    expect(nextPhrase('Done.\n\nNext: say "merge it"')).toBe('merge it')
    expect(nextPhrase('**Next:** reply “build it” and I do it.\n')).toBe('build it')
    expect(nextPhrase('Next: say "merge it"\n\nMore text.')).toBeNull()
    expect(nextPhrase('Next: open the map.')).toBeNull()
  })
})
