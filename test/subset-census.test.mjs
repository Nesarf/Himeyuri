// 子集普查：self/ 那六份到底用了哪些构造。
//
// 这一套自己扫一遍，而不是读文档里的数字——文档与源码一旦不一致，
// 要信的应该是源码。而它钉的正是「子集里必须有什么」这件事。
//
// 一条教训记在这里：第一次扫漏了 If 与 While 里面的表达式，
// 于是运算符只数出五种，而那个「干净」的结果差点被写进决策。
// 所以这一套不只数种类，还钉住「If 与 While 的条件确实被扫到」——
// 办法是核一个必然出现的运算符：<（i < len(...) 到处都是）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 语句 = new Map(), 表达式 = new Map(), 运算符 = new Map(), 字面量 = new Map();
const 计 = (表, k) => 表.set(k, (表.get(k) || 0) + 1);

const 走表达式 = (n) => {
  if (!n || typeof n !== "object") return;
  计(表达式, n.kind);
  if (n.kind === "Literal") 计(字面量, String(n.type));
  if (n.kind === "Binary" || n.kind === "Unary") 计(运算符, String(n.op));
  switch (n.kind) {
    case "If": 走表达式(n.condition); 走语句(n.then); 走语句(n.otherwise); break;
    case "While": 走表达式(n.condition); 走语句(n.body); break;
    case "Binary": 走表达式(n.left); 走表达式(n.right); break;
    case "Unary": 走表达式(n.operand); break;
    case "Call": 走表达式(n.callee); (n.args || []).forEach(走表达式); break;
    case "Index": 走表达式(n.target); 走表达式(n.index); break;
    case "Field": 走表达式(n.target); break;
    case "Tuple": (n.items || []).forEach(走表达式); break;
    case "Record": (n.fields || []).forEach((f) => 走表达式(f.value)); break;
  }
};
const 走语句 = (s) => {
  if (!s || typeof s !== "object") return;
  计(语句, s.kind);
  switch (s.kind) {
    case "Let": case "Var": 走表达式(s.value); break;
    case "Assign": 走表达式(s.value); break;
    case "Return": if (s.value) 走表达式(s.value); break;
    case "ExprStmt": 走表达式(s.expr); break;
    case "Block": (s.statements || []).forEach(走语句); break;
    case "If": 走表达式(s.condition); 走语句(s.then); 走语句(s.otherwise); break;
    case "While": 走表达式(s.condition); 走语句(s.body); break;
  }
};

for (const 名 of ["lex", "chain", "stmt", "body", "eval", "run"]) {
  const 源 = fs.readFileSync(path.join(ROOT, "self", 名 + ".hmyr"), "utf8");
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(源, { diagnostics: d }).tokens, { diagnostics: d });
  for (const decl of ast.decls) {
    if (decl.kind === "Fn") { for (const p of decl.params) if (p.fallback) 走表达式(p.fallback); 走语句(decl.body); }
    if (decl.kind === "Const") 走表达式(decl.value);
  }
}

console.log("一、语句：六种");
{
  const 应 = ["Assign", "Block", "ExprStmt", "Let", "Return", "Var"];
  const 实 = [...语句.keys()].sort();
  ok("语句种类正好六种", 实.length === 6, 实.join(" "));
  ok("而它们是那六种", JSON.stringify(实) === JSON.stringify(应), 实.join(" "));
}

console.log("二、表达式：十一种");
{
  const 实 = [...表达式.keys()].sort();
  ok("表达式种类正好十一种", 实.length === 11, 实.join(" "));
  ok("含 If（它在这一门语言里也是表达式）", 实.includes("If"), 实.join(" "));
  ok("含 While", 实.includes("While"), 实.join(" "));
}

console.log("三、If 与 While 的条件确实被扫到（第一次就是漏在这里）");
{
  // < 必然出现：i < len(...) 在六份里到处都是。
  ok("运算符里出现 <", 运算符.has("<"), [...运算符.keys()].sort().join(" "));
  const 数 = 运算符.size;
  ok("运算符共十四种", 数 === 14, String(数));
  console.log("    （" + [...运算符.keys()].sort().join(" ") + "）");
  ok("字面量三种", 字面量.size === 3, [...字面量.keys()].sort().join(" "));
}

console.log("四、而那份清单写进了文档");
{
  const 文 = fs.readFileSync(path.join(ROOT, "design/BOOTSTRAP.txt"), "utf8");
  ok("文档写了子集清单", 文.includes("子集到底要什么"), "在");
  ok("文档记着第一次扫漏的事", 文.includes("第一次扫漏了它"), "在");
  ok("文档改正了三四十行那个估计", 文.includes("三五百行更接近实际"), "在");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
