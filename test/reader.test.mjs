// 语法改写的验收：规则是数据，而改写之后读出来还是同一棵树。
//
// 最要紧的两条：
//   一、只换完整的记号，不换记号里面的一部分（否则 map 会把 remap 里的 map 换掉）
//   二、展开之后真能解析，而且解析出来的树与手写版本相同
//
// 第二条是「语法改写没坏事」的定义。没有它，这一层就只是一次字符串替换。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "reader.hmoca"));
ok("改写那一层加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};
const 树 = (src) => {
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  return JSON.stringify(ast).replace(/"(line|column|col|offset)":\d+,?/g, "");
};

const 规则们 = [["每当", "while"], ["否则", "if"]];

console.log("一、记号整个换掉");
{
  const 原 = "fn main() -> Int {\n  每当 1 < 2 { 1 }\n  return 0\n}\n";
  const 出 = call("展开", [原, 规则们]);
  ok("每当 变成了 while", 出.indexOf("while") >= 0 && 出.indexOf("每当") < 0, JSON.stringify(出.slice(0, 40)));
  ok("而别的字没动", 出.indexOf("return 0") >= 0);
}

console.log("二、只换完整的记号");
{
  // 规则是 map → remap，而 remap 里的 map 不该被换掉
  const 原 = "let remap = 1\nlet map = 2\n";
  const 出 = call("展开", [原, [["map", "MAP"]]]);
  ok("单独的 map 换掉了", 出.indexOf("MAP") >= 0, JSON.stringify(出));
  ok("而 remap 里的那一段没被换", 出.indexOf("reMAP") < 0, JSON.stringify(出));
  ok("remap 原样留着", 出.indexOf("remap = 1") >= 0, JSON.stringify(出));
}

console.log("三、没有规则就原样交回");
{
  const 原 = "fn f() { 每当 1 }";
  ok("空规则表原样", call("展开", [原, []]) === 原);
}

console.log("四、那条定义：展开之后是同一棵树");
{
  const 手写 = "fn main() -> Int {\n  var i = 0\n  while i < 3 {\n    i = i + 1\n  }\n  return i\n}\n";
  const 改写 = "fn main() -> Int {\n  var i = 0\n  每当 i < 3 {\n    i = i + 1\n  }\n  return i\n}\n";
  ok("展开之后与手写的树相同", 树(call("展开", [改写, 规则们])) === 树(手写));
}

console.log("五、工具能问「这个文件用了哪条规则」");
{
  ok("用了 每当 就说用了", call("用到", ["每当 1", 规则们, 0]) === true);
  ok("没用就说没用", call("用到", ["while 1", 规则们, 0]) === false);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
