// Himeyuri lexer - the first piece of the host implementation (milestone M2).
//
// It implements the lexical rules written down in SPEC.md section 2.1, and nothing else:
//   - source is UTF-8; a BOM is accepted and ignored
//   - identifiers are NFC-normalised, and one that mixes scripts is reported (HMYR-W0001)
//   - // line comments, /// doc comments, and /* */ block comments that NEST
//   - a newline ends a statement, unless the line ends in an operator or leaves a bracket open
//   - integer and float literals, with _ as a separator
//   - "strings" with escapes, and r"raw strings"
//
// Diagnostics carry stable identifiers (HMYR-E0001 ...). Section 4.2 of the spec says error text is
// part of the specification, so a code is never reused for a different meaning.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const KEYWORDS = new Set([
  "import", "as", "pub", "fn", "type", "const", "effect", "effects",
  "requires", "ensures", "invariant", "own", "borrow", "let", "var", "return", "while",
  "if", "else", "match", "true", "false", "nil", "arena", "managed",
]);

// Longest first, so that -> is not read as - followed by >.
// Unicode 别名：中文输入法下 ( 打出来就是 （，而 <= 在手感上就是 ≤。
// 与其报错让人天天撞墙，不如在词法里归一——于是源码接受得宽，而规范输出仍是 ASCII
// （格式化器那一侧保证）。这是那一条分工的具体做法。
const ALIASES = {
  "（": "(", "）": ")", "【": "[", "】": "]", "｛": "{", "｝": "}",
  "，": ",", "、": ",", "。": ".", "：": ":", "；": ";",
  "！": "!", "？": "?", "＝": "=", "＋": "+", "－": "-", "＊": "*", "／": "/", "％": "%",
  "＜": "<", "＞": ">",
  "≤": "<=", "≥": ">=", "≠": "!=", "≈": "==", "→": "->", "∧": "&&", "∨": "||", "¬": "!",
};

const PUNCT = [
  "->", "=>", "==", "!=", "<=", ">=", "&&", "||", "...", "::",
  "=", "+", "-", "*", "/", "%", "<", ">", "!", "?", ".", ",", ":", ";",
  "(", ")", "[", "]", "{", "}", "|", "&", "@", "#",
];

const OPENERS = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = { ")": "(", "]": "[", "}": "{" };

const SCRIPT_RANGES = [
  [0x0041, 0x024f, "Latin"],
  [0x0370, 0x03ff, "Greek"],
  [0x0400, 0x04ff, "Cyrillic"],
  [0x3040, 0x30ff, "Kana"],
  [0x3400, 0x4dbf, "Han"],
  [0x4e00, 0x9fff, "Han"],
  [0xac00, 0xd7af, "Hangul"],
];

// 诊断搬到了 src/diagnostics.mjs：它不属于任何一个阶段，而凡是要记错误的地方
// 都得 import 它。这里 import 再导出一次，是为了不让已有的 import 一起改。
// 两行都要：export ... from 只是把名字再卖出去，不会把它绑进本模块，而下面还要 new 它。
import { Diagnostics } from "./diagnostics.mjs";
export { Diagnostics };

const isDigit = (c) => c >= "0" && c <= "9";
const isHex = (c) => isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
const isIdentStart = (c) => /[\p{L}_]/u.test(c);
// Marks (\p{M}) belong to the identifier: e followed by a combining acute IS one identifier, and
// normalising it is only possible if the lexer reads the whole thing.
const isIdentPart = (c) => /[\p{L}\p{N}\p{M}_]/u.test(c);

function scriptsIn(name) {
  const found = new Set();
  for (const ch of name) {
    const cp = ch.codePointAt(0);
    for (const [lo, hi, label] of SCRIPT_RANGES) if (cp >= lo && cp <= hi) found.add(label);
  }
  return found;
}

export function lex(source, options = {}) {
  const text = source.replace(/^\uFEFF/, "");
  // 调用方传进来的诊断对象就用它——此前这里直接新建了一个，于是传进来的永远收不到。
  const diagnostics = options.diagnostics || new Diagnostics();
  const tokens = [];

  let i = 0, line = 1, column = 1;
  const bracketStack = [];
  let lastSignificant = null;   // the last token that was not a newline

  const peek = (n = 0) => text[i + n];
  const at = (s) => text.startsWith(s, i);

  function advance(n = 1) {
    for (let k = 0; k < n; k++) {
      if (text[i] === "\n") { line++; column = 1; } else { column++; }
      i++;
    }
  }

  function push(type, value, startLine, startColumn, extra = {}) {
    const token = { type, value, line: startLine, column: startColumn, ...extra };
    tokens.push(token);
    if (type !== "newline") lastSignificant = token;
    return token;
  }

  // An operator at the end of a line, or an unclosed bracket, means the statement continues.
  const continues = () => {
    // Only ( and [ continue a statement. A { opens a sequence of statements, so a newline inside a
    // block ends the statement - treating it as an open expression swallowed every newline in the
    // block and glued the statements together, which parsed as one long error.
    if (bracketStack.some((b) => b === "(" || b === "[")) return true;
    if (!lastSignificant) return false;
    if (lastSignificant.type === "punct" && !["(", ")", "[", "]", "{", "}", ",", ";"].includes(lastSignificant.value)) return true;
    return ["and", "or", "not"].includes(lastSignificant.value);
  };

  while (i < text.length) {
    const ch = text[i];

    // --- whitespace and statement-ending newlines ---
    if (ch === " " || ch === "\t") { advance(); continue; }
    if (ch === "\r") { advance(); continue; }
    if (ch === "\n") {
      if (!continues()) push("newline", "\n", line, column);
      advance();
      continue;
    }

    // --- comments ---
    if (at("///")) {
      const startLine = line, startColumn = column;
      let body = "";
      advance(3);
      while (i < text.length && text[i] !== "\n") { body += text[i]; advance(); }
      push("doc", body.trim(), startLine, startColumn);
      continue;
    }
    if (at("//")) {
      advance(2);
      while (i < text.length && text[i] !== "\n") advance();
      continue;
    }
    if (at("/*")) {
      const startLine = line, startColumn = column;
      let depth = 0;
      while (i < text.length) {
        if (at("/*")) { depth++; advance(2); continue; }
        if (at("*/")) { depth--; advance(2); if (depth === 0) break; continue; }
        advance();
      }
      if (depth !== 0) {
        diagnostics.error("HMYR-E0002", "block comment is never closed", startLine, startColumn);
        break;
      }
      continue;
    }

    // --- numbers ---
    if (isDigit(ch)) {
      const startLine = line, startColumn = column;
      let raw = "";
      if (at("0x") || at("0X") || at("0b") || at("0B") || at("0o") || at("0O")) {
        const base = text[i + 1].toLowerCase();
        raw += text[i] + text[i + 1];
        advance(2);
        const valid = base === "x" ? isHex : base === "b" ? (c) => c === "0" || c === "1" : (c) => c >= "0" && c <= "7";
        while (i < text.length && (valid(text[i]) || text[i] === "_")) { raw += text[i]; advance(); }
        const digits = raw.slice(2).replace(/_/g, "");
        if (!digits) diagnostics.error("HMYR-E0003", "based literal has no digits: " + raw, startLine, startColumn);
        push("int", raw, startLine, startColumn, { base: { x: 16, b: 2, o: 8 }[base] });
      } else {
        while (i < text.length && (isDigit(text[i]) || text[i] === "_")) { raw += text[i]; advance(); }
        let isFloat = false;
        if (text[i] === "." && isDigit(peek(1))) {
          isFloat = true; raw += text[i]; advance();
          while (i < text.length && (isDigit(text[i]) || text[i] === "_")) { raw += text[i]; advance(); }
        }
        if (text[i] === "e" || text[i] === "E") {
          let j = i + 1;
          if (text[j] === "+" || text[j] === "-") j++;
          if (isDigit(text[j])) {
            isFloat = true;
            raw += text[i]; advance();
            if (text[i] === "+" || text[i] === "-") { raw += text[i]; advance(); }
            while (i < text.length && isDigit(text[i])) { raw += text[i]; advance(); }
          }
        }
        if (/__|^_|_$/.test(raw)) diagnostics.error("HMYR-E0003", "misplaced separator in literal: " + raw, startLine, startColumn);
        push(isFloat ? "float" : "int", raw, startLine, startColumn, { numeric: Number(raw.replace(/_/g, "")) });
      }
      continue;
    }

    // --- strings ---
    const rawString = (ch === "r" || ch === "R") && peek(1) === '"';
    if (ch === '"' || rawString) {
      const startLine = line, startColumn = column;
      if (rawString) advance();
      advance();                                   // the opening quote
      let value = "";
      let closed = false;
      while (i < text.length) {
        if (!rawString && text[i] === "\\") {
          const esc = text[i + 1];
          const table = { n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", '"': '"' };
          if (esc in table) { value += table[esc]; advance(2); continue; }
          diagnostics.error("HMYR-E0005", "unknown escape: \\" + esc, line, column);
          advance(2);
          continue;
        }
        if (text[i] === '"') { advance(); closed = true; break; }
        if (text[i] === "\n") break;                // a plain string does not span lines
        value += text[i];
        advance();
      }
      if (!closed) diagnostics.error("HMYR-E0001", "string is never closed", startLine, startColumn);
      push("string", value, startLine, startColumn, { raw: rawString });
      continue;
    }

    // --- identifiers and keywords ---
    if (isIdentStart(ch)) {
      const startLine = line, startColumn = column;
      let name = "";
      while (i < text.length && isIdentPart(text[i])) { name += text[i]; advance(); }
      const normalized = name.normalize("NFC");
      const scripts = scriptsIn(normalized);
      if (scripts.size > 1) {
        diagnostics.warn("HMYR-W0001", "identifier mixes scripts (" + [...scripts].join(" + ") + "): " + normalized, startLine, startColumn);
      }
      if (KEYWORDS.has(normalized)) push("keyword", normalized, startLine, startColumn);
      else push("ident", normalized, startLine, startColumn, { wasNormalised: normalized !== name });
      continue;
    }

    // --- punctuation ---
    const punct = PUNCT.find((p) => at(p));
    if (punct) {
      const startLine = line, startColumn = column;
      if (OPENERS[punct]) bracketStack.push(punct);
      if (CLOSERS[punct]) {
        const open = bracketStack.pop();
        if (open !== CLOSERS[punct]) {
          diagnostics.error("HMYR-E0004", "unbalanced bracket: " + punct + " closes nothing", startLine, startColumn);
        }
      }
      advance(punct.length);
      push("punct", punct, startLine, startColumn);
      continue;
    }

    // --- Unicode 别名 ---
    // 在这里而不是在预处理里做，是因为归一之后可能是两个字符（≤ 变成 <=），
    // 而 token 是一个整体：在预处理里换会打乱行列号，也会把两个字符拆成两条路。
    const alias = ALIASES[ch];
    if (alias) {
      const startLine = line, startColumn = column;
      if (OPENERS[alias]) bracketStack.push(alias);
      if (CLOSERS[alias]) {
        const open = bracketStack.pop();
        if (open !== CLOSERS[alias]) {
          diagnostics.error("HMYR-E0004", "unbalanced bracket: " + alias + " closes nothing", startLine, startColumn);
        }
      }
      advance();
      push("punct", alias, startLine, startColumn);
      continue;
    }

    diagnostics.error("HMYR-E0006", "character cannot start a token: " + JSON.stringify(ch), line, column);
    advance();
  }

  for (const open of bracketStack) {
    diagnostics.error("HMYR-E0004", "bracket is never closed: " + open, line, column);
  }

  tokens.push({ type: "eof", value: "", line, column });
  return { tokens, diagnostics, source: options.path || "<memory>" };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const file = process.argv[2];
  if (!file) { console.log("usage: node lexer.mjs <file.hmyr>"); process.exit(1); }
  const result = lex(fs.readFileSync(file, "utf8"), { path: file });
  console.log(path.basename(file) + ": " + result.tokens.length + " token(s)");
  for (const d of result.diagnostics.items) {
    console.log("  " + d.severity + " " + d.code + " " + d.line + ":" + d.column + "  " + d.message);
  }
  console.log("  errors: " + result.diagnostics.errors.length + ", warnings: " + result.diagnostics.warnings.length);
  process.exit(result.diagnostics.errors.length ? 1 : 0);
}
