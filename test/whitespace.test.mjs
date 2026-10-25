// 空白规范化的验收：只动空白，而语义不变。
//
// 那条客观标准写在最上面，因为它是「对不对」的定义：
//   解析 → 重排 → 再解析，两次得到的 AST 必须相同。
// 而对「只动空白」来说它会自动成立——而「自动成立」也得验，否则哪天有人
// 顺手加一条「把连续空格压成一个」，那条标准就会立刻不再自动成立。
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

const unit = loadUnit(path.join(ROOT, "whitespace.hmoca"));
ok("空白规范化那一层加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const 规 = (s) => {
  const fn = rt.functions.get("规范化");
  return rt.callFunction(fn, [s], null);
};
// 比较 AST 时去掉位置：行号与列号是格式化器**会**改变的东西，
// 而它们不属于「语义」。去掉它们之后还相同，才说明重排没有改意思。
const 树 = (src) => {
  const d = { items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} };
  const { ast } = parse(lex(src, { diagnostics: d }).tokens, { diagnostics: d });
  return JSON.stringify(ast).replace(/"(line|column|col|offset)":\d+,?/g, "");
};

console.log("一、四样空白都变干净");
{
  const 原 = "fn main() {\n\tprint(\"hi\")   \n\n\n  return 0\n}";
  const 出 = 规(原);
  ok("制表符变成两个空格", 出.indexOf("\t") < 0 && 出.indexOf("  print") === 0 || 出.indexOf("  print") >= 0, JSON.stringify(出));
  ok("行尾空白没了", 出.indexOf("\"hi\")   ") < 0, JSON.stringify(出));
  ok("三个空行压成一个", 出.indexOf("\n\n\n") < 0, JSON.stringify(出));
  ok("末尾有且只有一个换行", 出.endsWith("\n") && !出.endsWith("\n\n"), JSON.stringify(出.slice(-4)));
}

console.log("二、幂等：排两遍与排一遍一样");
{
  const 原 = "fn main() {\n\t\tprint(\"a\")\n\n\n\n  return 1\n}\n\n\n";
  ok("第一遍与第二遍相同", 规(规(原)) === 规(原));
}

console.log("三、那条客观标准：AST 不变");
{
  const 原们 = [
    "fn main() {\n\tprint(\"hi\")   \n\n\n  return 0\n}",
    "fn f(a: Int) -> Int {\n  return a\n}\nfn main() -> Int {\n\treturn f(1)\n}\n\n\n",
    "fn main() -> Int {\n  let x = 1\n  return x\n}\n",
  ];
  let 全同 = true;
  for (const 原 of 原们) {
    if (树(原) !== 树(规(原))) { 全同 = false; console.log("    有一处不同：" + JSON.stringify(原.slice(0, 30))); }
  }
  ok("三份源码重排前后是同一个 AST", 全同);
}

console.log("四、内容一点都不碰");
{
  const 原 = "fn main() -> Int {\n  print(\"a  b\")   \n  return 0\n}\n";
  const 出 = 规(原);
  ok("字符串里的两个空格原样保留", 出.indexOf("\"a  b\"") >= 0, JSON.stringify(出));
  ok("而它自己不该多出东西", 出.length <= 原.length + 1, 出.length + " 对 " + 原.length);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
