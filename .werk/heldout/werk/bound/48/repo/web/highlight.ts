// The fenced-code highlighter (#werk-codeblock, #werk-codeblock-langs). Pure: code and its
// fence tag in, safe HTML out. A tag picks a grammar by any common name in any letter case;
// a tag with no grammar, or no tag, renders the code plain in the same box.

import { escapeHtml } from "./escape";

type Rule = readonly [cls: string | null, pattern: RegExp];
type Grammar = readonly Rule[];

const STRING_DQ = /"(?:\\.|[^"\\\n])*"?/y;
const STRING_SQ = /'(?:\\.|[^'\\\n])*'?/y;
const BLOCK_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/y;
const LINE_COMMENT = /\/\/[^\n]*/y;

const SHELL: Grammar = [
  ["com", /(?<![^\s;|&(])#[^\n]*/y],
  ["str", STRING_DQ],
  ["str", /'[^']*'?/y],
  ["var", /\$\{[^}\n]*\}?|\$[A-Za-z_]\w*|\$[0-9@#?*$!-]/y],
  [
    "kw",
    /\b(?:if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|return|export|local|echo|cd|exit|source)\b/y,
  ],
  ["flag", /(?<=\s)--?[A-Za-z][\w-]*/y],
  [null, /[A-Za-z_][\w./-]*/y],
];

const SCRIPT: Grammar = [
  ["com", LINE_COMMENT],
  ["com", BLOCK_COMMENT],
  ["str", STRING_DQ],
  ["str", STRING_SQ],
  ["str", /`(?:\\[\s\S]|[^`\\])*`?/y],
  [
    "kw",
    /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|export|from|default|async|await|type|interface|enum|implements|of|in|typeof|instanceof|as|try|catch|finally|throw|yield|void|readonly|declare|keyof)\b/y,
  ],
  ["lit", /\b(?:true|false|null|undefined|this)\b/y],
  ["num", /\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?\b/y],
  [null, /[A-Za-z_$][\w$]*/y],
];

const JSON_GRAMMAR: Grammar = [
  ["com", LINE_COMMENT],
  ["com", BLOCK_COMMENT],
  ["key", /"(?:\\.|[^"\\\n])*"(?=\s*:)/y],
  ["str", STRING_DQ],
  ["lit", /\b(?:true|false|null)\b/y],
  ["num", /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y],
];

const GRAMMARS: Record<string, Grammar> = { shell: SHELL, script: SCRIPT, json: JSON_GRAMMAR };

const ALIASES: Record<string, string> = {
  sh: "shell",
  shell: "shell",
  zsh: "shell",
  bash: "shell",
  ts: "script",
  tsx: "script",
  typescript: "script",
  js: "script",
  jsx: "script",
  javascript: "script",
  mjs: "script",
  cjs: "script",
  json: "json",
  jsonc: "json",
};

/** The grammar name a fence tag selects, or undefined when no grammar knows the tag. */
export function grammarFor(tag: string): string | undefined {
  return ALIASES[tag.trim().toLowerCase()];
}

/** The code as escaped HTML, with a span per token when the tag selects a grammar. */
export function highlight(code: string, tag: string): string {
  const name = grammarFor(tag);
  const grammar = name === undefined ? undefined : GRAMMARS[name];
  if (grammar === undefined) return escapeHtml(code);
  let out = "";
  let plain = "";
  let pos = 0;
  while (pos < code.length) {
    const hit = matchAt(grammar, code, pos);
    if (hit === undefined) {
      plain += code[pos];
      pos += 1;
      continue;
    }
    const [cls, text] = hit;
    if (cls === null) {
      plain += text;
    } else {
      out += `${escapeHtml(plain)}<span class="tok-${cls}">${escapeHtml(text)}</span>`;
      plain = "";
    }
    pos += text.length;
  }
  return out + escapeHtml(plain);
}

function matchAt(grammar: Grammar, code: string, pos: number): [string | null, string] | undefined {
  for (const [cls, pattern] of grammar) {
    pattern.lastIndex = pos;
    const match = pattern.exec(code);
    if (match !== null && match[0] !== "") return [cls, match[0]];
  }
  return undefined;
}

/** A fenced block: a box that scrolls sideways, with the tag as a corner label when there is one. */
export function codeBlock(code: string, tag: string): string {
  const name = grammarFor(tag);
  const label = tag.trim() === "" ? "" : `<span class="codebox-tag">${escapeHtml(tag.trim())}</span>`;
  const lang = name === undefined ? "" : ` data-grammar="${name}"`;
  return `<div class="codebox">${label}<pre><code${lang}>${highlight(code, tag)}</code></pre></div>`;
}
