// 错误路径上的话：一组坏程序，两边给同一个码、同一个位置。
//
// 这一套钉的是「子集这一层能不能替宿主那两层说话」的另一半。前几套钉的是好程序
// （token 相同、树相同、跑起来相同），而报错不是好程序的附属品——它是人读到的第一条信息。
//
// 比的只有码与位置，不比消息文本。消息的措辞可以不同（这一份写中文），而码是给人查的，
// 位置是给人点过去的。两样都要一样。
//
// 一条边界明写在这里：这一类只覆盖「宿主也会报的语法错」。宿主读得动、而子集还不认的构造
// （type / const / match / 泛型 / 可空 / 默认值 / own / 带参数的效果 / 无体函数）
// 是抛，不是诊断——那是这一份的边界，由 subset-parse 那一套钉着。
import { pathToFileURL } from "node:url";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { 切 } from "../src/subset-lex.mjs";
import { 子集解 } from "../src/subset-parse.mjs";

let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 新诊断 = () => ({
  items: [], errors: [], warnings: [],
  add(severity, code, message, line, column) {
    const one = { severity, code, message, line, column };
    this.items.push(one);
    if (severity === "error") this.errors.push(one);
  },
  error(code, message, line, column) { this.add("error", code, message, line, column); },
  warn(code, message, line, column) { this.add("warning", code, message, line, column); },
});
const 首条解析错 = (d) => d.items.find((i) => /HMYR-E01\d\d/.test(i.code));
const 示 = (x) => x ? x.code + " 行 " + x.line + " 列 " + x.column : "（没有）";

const 例们 = [
  ["顶层一个 let", "let a = \n"],
  ["return 后面是坏 token", "fn f() {\n  return * 2\n}\n"],
  ["参数表没关", "fn f(a: Int {\n  return 1\n}\n"],
  ["一个语句后多一个值", "fn f() {\n  let a = 1 2\n}\n"],
  ["块没关（指到文件尾）", "fn f() {\n  let a = 1\n"],
  ["调用实参缺逗号", "fn f() -> Int {\n  return g(1 2)\n}\n"],
  ["缺等号", "fn f() {\n  let a 1\n}\n"],
  ["参数名后缺冒号", "fn f(a Int) -> Int {\n  return 1\n}\n"],
];

console.log("一、八种语法错：同一个码、同一个位置");
for (const [名, 源] of 例们) {
  const 主D = 新诊断();
  parse(lex(源, { diagnostics: 主D }).tokens, { diagnostics: 主D });
  const 主 = 首条解析错(主D);

  const 子D = 新诊断();
  let 抛 = "";
  try { 子集解(切(源), { diagnostics: 子D }); } catch (e) { 抛 = e.message; }
  const 子 = 首条解析错(子D);

  ok(名 + "（" + 示(主) + "）", !抛 && 主 && 子 && 主.code === 子.code && 主.line === 子.line && 主.column === 子.column,
    "宿主 " + 示(主) + " · 子集 " + 示(子) + (抛 ? " · 抛了：" + 抛 : ""));
}

console.log("二、默认模式不抛，而是记诊断并继续（恢复的意义）");
{
  const d = 新诊断();
  let 抛 = "";
  try { 子集解(切("fn f() {\n  let a = 1 2\n}\nfn g() -> Int {\n  return 1\n}\n"), { diagnostics: d }); } catch (e) { 抛 = e.message; }
  ok("不抛", 抛 === "", 抛);
  ok("记下了那一条", d.errors.length >= 1, String(d.errors.length));
  // 恢复的实际好处：后面的函数照旧被读进来，于是一个错不会让整份源码都读不成。
  const 树 = 子集解(切("fn f() {\n  let a = 1 2\n}\nfn g() -> Int {\n  return 1\n}\n"), { diagnostics: 新诊断() }).ast;
  ok("后面的函数仍然被读进来（两个声明）", 树.decls.length === 2, 树.decls.map((x) => x.name).join(" "));
}

console.log("三、strict 模式：语法错也抛，而且抛出的消息里有码");
{
  let 错 = "";
  try { 子集解(切("fn f() {\n  let a = 1 2\n}\n"), { strict: true }); } catch (e) { 错 = e.message; }
  ok("抛了", 错 !== "", 错);
  ok("消息里有 HMYR-形-003", 错.includes("HMYR-形-002"), 错);
}

console.log("四、边界照旧：子集不认的构造仍然抛，而不是记成语法错");
for (const [标, 源] of [
  ["type 声明", "type T = Int\n"],
  ["match", "fn f() -> Int {\n  return match 1 { 1 => 2 }\n}\n"],
  ["泛型", "fn f<T>(a: T) -> Int { return 1 }\n"],
]) {
  let 错 = "";
  try { 子集解(切(源), { diagnostics: 新诊断() }); } catch (e) { 错 = e.message; }
  ok(标 + "：抛而不是记诊断", 错 !== "", 错 || "（没有抛）");
}

console.log("五、那一张对照表自己也要能核");
{
  // 上面八例的宿主答案抄在这里，改宿主那边就该红——而不是让这张表悄悄过期。
  const 应 = ["HMYR-形-003@1:1", "HMYR-形-004@2:10", "HMYR-形-001@1:13", "HMYR-形-002@2:13",
    "HMYR-形-001@3:1", "HMYR-形-001@2:14", "HMYR-形-001@2:9", "HMYR-形-001@1:8"];
  const 实 = [];
  for (const [, 源] of 例们) {
    const d = 新诊断();
    parse(lex(源, { diagnostics: d }).tokens, { diagnostics: d });
    const 首 = 首条解析错(d);
    实.push(首 ? 首.code + "@" + 首.line + ":" + 首.column : "无");
  }
  ok("宿主的八个答案与这一套记的一致", JSON.stringify(实) === JSON.stringify(应), JSON.stringify(实));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
