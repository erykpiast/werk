/** Colours fenced code by the tag on the fence. A tag with no grammar gives plain escaped text (#werk-codeblock-langs). */
import { escapeHtml } from "./escape.ts";

type Grammar = "json" | "script" | "shell";
type Rule = readonly [cls: string, pattern: RegExp];

const TAGS: Record<string, Grammar> = {
  json: "json",
  jsonc: "json",
  json5: "json",
  js: "script",
  javascript: "script",
  jsx: "script",
  mjs: "script",
  cjs: "script",
  ts: "script",
  typescript: "script",
  tsx: "script",
  mts: "script",
  cts: "script",
  sh: "shell",
  shell: "shell",
  bash: "shell",
  zsh: "shell",
  ksh: "shell",
};

const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/y;
const NUMBER = /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y;
const SLASH_COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y;

const RULES: Record<Grammar, readonly Rule[]> = {
  json: [
    ["comment", SLASH_COMMENT],
    ["key", /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y],
    ["string", /"(?:[^"\\\n]|\\.)*"/y],
    ["number", NUMBER],
    ["literal", /\b(?:true|false|null)\b/y],
  ],
  script: [
    ["comment", SLASH_COMMENT],
    [
      "string",
      /`(?:[^`\\]|\\[\s\S])*`?|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/y,
    ],
    ["number", NUMBER],
    [
      "keyword",
      /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|type|interface|enum|as|satisfies|readonly)\b/y,
    ],
    ["literal", /\b(?:true|false|null|undefined|this)\b/y],
  ],
  shell: [
    ["comment", /(?<![^\s])#[^\n]*/y],
    ["string", STRING],
    ["variable", /\$(?:\w+|\{[^}\n]*\}|\([^)\n]*\))/y],
    ["flag", /(?<![^\s])--?[A-Za-z][\w-]*/y],
    [
      "keyword",
      /\b(?:if|then|elif|else|fi|for|while|until|do|done|case|esac|in|function|export|local|return)\b/y,
    ],
  ],
};

/** The grammar that a fence tag selects, in any letter case, or null when the tag has none. */
export function grammarFor(tag: string): Grammar | null {
  return TAGS[tag.trim().toLowerCase()] ?? null;
}

/** The code as escaped HTML, with a span around each token of the tag's grammar. */
export function highlight(code: string, tag: string): string {
  const grammar = grammarFor(tag);
  if (grammar === null) return escapeHtml(code);
  const rules = RULES[grammar];
  let out = "";
  let plain = "";
  let i = 0;
  while (i < code.length) {
    let hit: { cls: string; text: string } | null = null;
    for (const [cls, pattern] of rules) {
      pattern.lastIndex = i;
      const m = pattern.exec(code);
      if (m && m[0] !== "") {
        hit = { cls, text: m[0] };
        break;
      }
    }
    if (hit === null) {
      plain += code[i];
      i += 1;
      continue;
    }
    out += escapeHtml(plain);
    plain = "";
    out += `<span class="tok-${hit.cls}">${escapeHtml(hit.text)}</span>`;
    i += hit.text.length;
  }
  return out + escapeHtml(plain);
}
