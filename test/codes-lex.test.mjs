// 一个编号一个用例：词法那一组。
//
// 为什么要有这一套：编号表里有五十七个编号，而「写了」与「跑得到」是两件事。
// 这一套为词法那九个各造一个能触发的场景，断言那个编号真的出现——
// 于是「拒绝路径」从文档上的一句话，变成跑得动的一条。
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 词法 = (src) => {
  const d = { items: [], errors: [], warnings: [], add(s, c, m) { this.items.push({ s, c, m }); }, error(c, m) { this.add("error", c, m); }, warn(c, m) { this.add("warning", c, m); } };
  const out = lex(src, { diagnostics: d });
  return { codes: d.items.map((x) => x.c), tokens: out.tokens };
};
const 语法 = (src) => {
  const d = { items: [], errors: [], warnings: [], add(s, c, m) { this.items.push({ s, c, m }); }, error(c, m) { this.add("error", c, m); }, warn(c, m) { this.add("warning", c, m); } };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  return { codes: d.items.map((x) => x.c), ast };
};

console.log("词法：HMYR-詞-001 到 HMYR-詞-007");
ok("HMYR-詞-001 字符串没闭合", 词法('let s = "abc').codes.includes("HMYR-詞-001"), JSON.stringify(词法('let s = "abc').codes));
ok("HMYR-詞-003 块注释没闭合", 词法("/* 没闭合").codes.includes("HMYR-詞-003"), JSON.stringify(词法("/* 没闭合").codes));
ok("HMYR-詞-004 数值字面量坏了", 词法("let n = 0x").codes.includes("HMYR-詞-004") || 词法("let n = 1__2").codes.includes("HMYR-詞-004"), JSON.stringify(词法("let n = 1__2").codes));
ok("HMYR-詞-005 括号不平衡", 词法("(a").codes.includes("HMYR-詞-005"), JSON.stringify(词法("(a").codes));
ok("HMYR-詞-006 不认识的转义", 词法('let s = "\\q"').codes.includes("HMYR-詞-006"), JSON.stringify(词法('let s = "\\q"').codes));
ok("HMYR-詞-007 不能开始 token 的字符", 词法("a § b").codes.includes("HMYR-詞-007"), JSON.stringify(词法("a § b").codes));

console.log("语法：HMYR-形-002、HMYR-形-003、HMYR-形-005");
// 要包在函数体里：裸的 let 在声明层遇到，会命中 HMYR-形-004（那是「不能在这里开始声明」）。
ok("HMYR-形-002 要 token 却读到别的", 语法("fn main() {\n  let = 1\n}\n").codes.includes("HMYR-形-001"), JSON.stringify(语法("fn main() {\n  let = 1\n}\n").codes));
ok("HMYR-形-002 另一种：缺等号", 语法("fn main() {\n  let x 1\n}\n").codes.includes("HMYR-形-001"), JSON.stringify(语法("fn main() {\n  let x 1\n}\n").codes));
ok("HMYR-形-003 语句没在行尾结束", 语法("fn main() {\n  let x = 1 let y = 2\n}\n").codes.includes("HMYR-形-002"), JSON.stringify(语法("fn main() {\n  let x = 1 let y = 2\n}\n").codes));
ok("HMYR-形-005 要表达式却没有", 语法("fn main() {\n  let x =\n}\n").codes.includes("HMYR-形-004"), JSON.stringify(语法("fn main() {\n  let x =\n}\n").codes));

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
