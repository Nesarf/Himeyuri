// The strict side of Unicode: what the language refuses, what it folds, and what is still open.
//
// Two kinds of checking live here. Refusal: a control character or an emoji in the source is an error
// rather than something quietly eaten - the earlier probe showed the tokenizer silently dropping
// characters it did not recognise, which is the one failure mode this project treats as a defect.
// Folding: identifiers are normalised, so the two spellings of an accented letter are one name.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const attempt = (fn) => { try { return { value: fn() }; } catch (e) { return { error: (e.code || "") + " " + e.message }; } };

const lexed = (source) => {
  const diagnostics = { items: [], errors: [], warnings: [], add(s, c, m) { this.items.push({ s, c, m }); if (s === "error") this.errors.push({ code: c, message: m }); }, error(c, m) { this.add("error", c, m); }, warn(c, m) { this.add("warning", c, m); } };
  return { diagnostics, ...lex(source, { diagnostics }) };
};

console.log("what it refuses: control characters and emoji");
{
  // a bell, a zero-width joiner, an emoji, a raw escape
  const cases = [
    ["响铃控制符", "let x = 1" + String.fromCharCode(7) + "\n"],
    ["零宽连接符", "let x" + String.fromCharCode(0x200d) + "y = 1\n"],
    ["Emoji", "let x = " + String.fromCodePoint(0x1f600) + "\n"],
    ["裸转义字节", "let x = 1" + String.fromCharCode(27) + "\n"],
  ];
  for (const [label, source] of cases) {
    const out = attempt(() => lexed(source));
    const errs = out.error ? [out.error] : out.value.diagnostics.errors.map((e) => e.code);
    ok(label + " 被拒绝", errs.length > 0 && errs.join(",").includes("HMYR-詞-007"), out.error || errs.join(",") || "没有报错");
  }
}
{
  // the counter-example that matters: the ordinary whitespace controls must still be fine
  const out = lexed("let x = 1\nlet y = 2\r\n\tlet z = 3\n");
  ok("换行、回车与制表符仍然合法", out.diagnostics.errors.length === 0, out.diagnostics.errors.map((e) => e.code).join(","));
}

console.log("\nwhat it folds: identifiers are normalised");
{
  const composed = lexed("let café = 1").tokens.filter((t) => t.type === "ident").map((t) => t.value);
  const decomposed = lexed("let cafe\u0301 = 1").tokens.filter((t) => t.type === "ident").map((t) => t.value);
  ok("两种写法归一成同一个名字", composed.join(",") === decomposed.join(","), composed.join(",") + "    " + decomposed.join(","));
  ok("而它就是 NFC 形态", composed[0] === "café".normalize("NFC"), JSON.stringify(composed));
}

console.log("\nthe bootstrapped lexer now folds the same way");
{
  const unit = loadUnit(path.join(ROOT, "self/lex.hmoca"));
  ok("自举词法加载", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
  const rt = runUnit(unit);
  const scan = (s) => rt.callFunction(rt.functions.get("scan"), [s], null);
  const mine = scan("let café = 1").map((t) => t.kind + ":" + t.text).join(" ");
  const theirs = lexed("let café = 1").tokens.filter((t) => t.type !== "newline" && t.type !== "eof")
    .map((t) => (t.type === "keyword" ? "ident:" + t.value : t.type + ":" + t.value)).join(" ");
  ok("两边逐 token 一致（含组合记号）", mine === theirs, "自举: " + mine + "   宿主: " + theirs);
  const m2 = scan("let cafe\u0301 = 1").map((t) => t.text).join("|");
  ok("自举那边也把两种写法合成一个名字", m2 === scan("let café = 1").map((t) => t.text).join("|"), m2);
}

console.log("\nstill open, and pinned so it cannot be forgotten");
{
  // full-width punctuation is dropped silently today. That is the defect this step exists to remove;
  // it is not fixed yet, and the assertion says so rather than pretending otherwise.
  const out = lexed("if （a） { return 1 }\n");
  const dropped = !out.tokens.some((t) => t.value === "（" || t.value === "）");
  ok("全角标点现在被归一成 ASCII 记号（不再报错，也不再被吞掉）",
    out.diagnostics.errors.length === 0 && out.tokens.some((x) => x.value === "(") && out.tokens.some((x) => x.value === ")"),
    out.diagnostics.errors.map((e) => e.code).join(",") || "没有报错，token：" + out.tokens.map((x) => x.type + ":" + x.value).join(" "));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
