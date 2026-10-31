// Lexer tests: every lexical rule in SPEC 2.1 gets a case, and every diagnostic gets a case that must
// fire. Written before the parser on purpose - a lexer that only handles the happy path is the reason
// parsers later grow special cases.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex, 关键字别名 } from "../src/lexer.mjs";
import { 切 } from "../src/subset-lex.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const kinds = (r) => r.tokens.filter((t) => t.type !== "eof" && t.type !== "newline").map((t) => t.type + ":" + t.value).join(" ");
const codes = (r) => r.diagnostics.items.map((d) => d.code);

console.log("identifiers");
{
  const r = lex("let 名前 = 1\n");
  ok("unicode identifier kept", kinds(r) === "keyword:let ident:名前 punct:= int:1");
  ok("no diagnostics", r.diagnostics.items.length === 0);
}
{
  const r = lex("let идent = 1\n");   // Cyrillic и,д followed by Latin e,n,t
  ok("mixed-script identifier warns (HMYR-詞-002)", codes(r).includes("HMYR-詞-002"));
  ok("but is not an error", r.diagnostics.errors.length === 0);
}
{
  const r = lex("let e\u0301clair = 1\n");       // e + combining acute
  const ident = r.tokens.find((t) => t.type === "ident");
  ok("identifier is NFC-normalised", ident.value === "éclair");
  ok("normalisation is recorded", ident.wasNormalised === true);
}

console.log("\ncomments");
{
  const r = lex("// line\nlet x = 1\n/// doc\n");
  ok("line comment is dropped", !kinds(r).includes("line"));
  ok("doc comment becomes a token", r.tokens.some((t) => t.type === "doc" && t.value === "doc"));
}
{
  const r = lex("/* outer /* inner */ still outer */ let x = 1\n");
  ok("block comments nest", kinds(r) === "keyword:let ident:x punct:= int:1");
  ok("no diagnostic for a properly nested comment", r.diagnostics.items.length === 0);
}
{
  const r = lex("/* never closed\nlet x = 1\n");
  ok("unclosed block comment is HMYR-詞-003", codes(r).includes("HMYR-詞-003"));
}

console.log("\nnewlines end statements, operators continue them");
{
  const r = lex("let x = 1\nlet y = 2\n");
  ok("each statement separated by a newline token", r.tokens.filter((t) => t.type === "newline").length === 2);
}
{
  const r = lex("let z = 1 +\n  2\n");
  ok("a line ending in an operator continues", r.tokens.filter((t) => t.type === "newline").length === 1);
}
{
  const r = lex("let f = g(\n  1,\n  2\n)\n");
  ok("an open bracket continues the statement", r.tokens.filter((t) => t.type === "newline").length === 1);
}

console.log("\nnumbers");
{
  const r = lex("0x1F 0b1010 0o17 1_000_000 3.5 1e9\n");
  const values = r.tokens.filter((t) => t.type === "int" || t.type === "float");
  ok("based literals carry a base", values[0].base === 16 && values[1].base === 2 && values[2].base === 8);
  ok("separator does not change the value", values[3].numeric === 1000000);
  ok("float is a float", values[4].type === "float" && values[5].type === "float");
}
{
  const r = lex("1__0\n");
  ok("misplaced separator is HMYR-詞-004", codes(r).includes("HMYR-詞-004"));
}

console.log("\nstrings");
{
  const r = lex('"a\\nb"\n');
  ok("escape is interpreted", r.tokens[0].value === "a\nb");
}
{
  const r = lex('r"a\\nb"\n');
  ok("raw string keeps the backslash", r.tokens[0].value === "a\\nb" && r.tokens[0].raw === true);
}
{
  const r = lex('"unterminated\n');
  ok("unterminated string is HMYR-詞-001", codes(r).includes("HMYR-詞-001"));
}
{
  const r = lex('"bad \\q escape"\n');
  ok("unknown escape is HMYR-詞-006", codes(r).includes("HMYR-詞-006"));
}

console.log("\nbrackets and stray characters");
{
  const r = lex("let x = (1 + 2\n");
  ok("unclosed bracket is HMYR-詞-005", codes(r).includes("HMYR-詞-005"));
}
{
  const r = lex("let x = 1 }\n");
  ok("stray closer is HMYR-詞-005", codes(r).includes("HMYR-詞-005"));
}
{
  const r = lex("let x = 1 ~ 2\n");
  ok("unknown character is HMYR-詞-007", codes(r).includes("HMYR-詞-007"));
}

console.log("\narrows and the spec's own example");
{
  const r = lex("pub fn read(p: Path) -> Bytes effects(file) { return p }\n");
  ok("-> is one token, not - and >", kinds(r).includes("punct:->"));
  ok("no diagnostics on a well-formed line", r.diagnostics.items.length === 0);
}
{
  const r = lex("\uFEFFlet x = 1\n");
  ok("a BOM is accepted and ignored", r.diagnostics.items.length === 0 && kinds(r) === "keyword:let ident:x punct:= int:1");
}

// 汉字关键字：三张表要一致，三个词法器的做法要一样（2026-11-02）
//
// 表在三个地方各有一份：宿主词法器、子集词法器、自举层的 关键字归一。分开是刻意的 ——
// 子集那一层不能 import 宿主的（那边拉着 node:path 与文件系统），自举那一层根本不是 JS。
// 而分开就会漂移，所以这一节把三边钉在一起：加一个词要么三处一起加，要么一处都不加。
{
  const 子集源 = fs.readFileSync(path.join(ROOT, "src/subset-lex.mjs"), "utf8");
  const 自举源 = fs.readFileSync(path.join(ROOT, "self/lex.hmoca"), "utf8");
  const 子集块 = /const 关键字别名 = \{([^}]*)\}/.exec(子集源);
  // 两种写法都认：这张表本身也在 self/lex.hmoca 里，而那个文件的关键字已经换成汉字了。
  // 先写死英文那一种，于是在源码换成「若 / 返回」之后它一条都找不到 —— 判据自己成了旧形状。
  const 自举对 = [...自举源.matchAll(/(?:if|若) 词 == "([^"]+)" \{ (?:return|返回) "([^"]+)" \}/g)].map((m) => [m[1], m[2]]);
  ok("子集那一份关键字别名表在", !!子集块, "");
  ok("自举那一份关键字归一表在", 自举对.length > 0, String(自举对.length));
  const 归 = (对) => JSON.stringify(Object.entries(对).sort());
  if (子集块) {
    const 子集 = {};
    for (const 段 of 子集块[1].split(",")) {
      const m = /([^\s:]+)\s*:\s*"([^"]+)"/.exec(段);
      if (m) 子集[m[1]] = m[2];
    }
    ok("子集那张表与宿主相同", 归(子集) === 归(关键字别名), 归(子集) + " 对 " + 归(关键字别名));
  }
  if (自举对.length) {
    const 自举 = Object.fromEntries(自举对);
    ok("自举那张表与宿主相同", 归(自举) === 归(关键字别名), 归(自举) + " 对 " + 归(关键字别名));
  }
  // 同一个词，三个词法器交回同一个英文关键字
  const 源 = "定 x = 1\n";
  ok("宿主词法器把它归一成 let", kinds(lex(源)).startsWith("keyword:let"), kinds(lex(源)));
  const 子 = 切(源).filter((t) => t.type !== "eof" && t.type !== "newline").map((t) => t.type + ":" + t.value).join(" ");
  ok("子集词法器把它归一成 let", 子.startsWith("keyword:let"), 子);
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
