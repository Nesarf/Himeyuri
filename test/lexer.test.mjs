// Lexer tests: every lexical rule in SPEC 2.1 gets a case, and every diagnostic gets a case that must
// fire. Written before the parser on purpose - a lexer that only handles the happy path is the reason
// parsers later grow special cases.
import { lex } from "../src/lexer.mjs";

let passed = 0, failed = 0;
const ok = (label, condition) => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label); }
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
  ok("mixed-script identifier warns (HMYR-W0001)", codes(r).includes("HMYR-W0001"));
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
  ok("unclosed block comment is HMYR-E0002", codes(r).includes("HMYR-E0002"));
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
  ok("misplaced separator is HMYR-E0003", codes(r).includes("HMYR-E0003"));
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
  ok("unterminated string is HMYR-E0001", codes(r).includes("HMYR-E0001"));
}
{
  const r = lex('"bad \\q escape"\n');
  ok("unknown escape is HMYR-E0005", codes(r).includes("HMYR-E0005"));
}

console.log("\nbrackets and stray characters");
{
  const r = lex("let x = (1 + 2\n");
  ok("unclosed bracket is HMYR-E0004", codes(r).includes("HMYR-E0004"));
}
{
  const r = lex("let x = 1 }\n");
  ok("stray closer is HMYR-E0004", codes(r).includes("HMYR-E0004"));
}
{
  const r = lex("let x = 1 ~ 2\n");
  ok("unknown character is HMYR-E0006", codes(r).includes("HMYR-E0006"));
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

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
