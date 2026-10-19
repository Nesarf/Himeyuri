// 语言档案的验收：中日英三套（四份，因为中文给了两种编码）。
//
// 要紧的是最后一条：**档案绝不影响语法与求值**。所以这里除了查表与切换，
// 还要验「同一段程序在不同档案下算出同一个结果」。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { lex } from "../src/lexer.mjs";
import { parse } from "../src/parser.mjs";
import { Runtime } from "../src/eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "locale.hmyr")));
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

console.log("四套档案都在，字段对得上");
{
  const 表 = call("档案表", []);
  ok("四套", Array.isArray(表) && 表.length === 4, String(表 && 表.length));
  const 名字 = 表.map((x) => x[0]);
  ok("名字是语言加编码", JSON.stringify(名字) === JSON.stringify(["zh-CN.gbk", "zh-CN.utf8", "ja-JP.shift_jis", "en-US.utf8"]), JSON.stringify(名字));
  ok("中文给了两种编码", 名字.filter((n) => n.startsWith("zh-CN.")).length === 2);
  ok("中文那两套语言相同、编码不同", call("档案的文字", ["zh-CN.gbk"]) === call("档案的文字", ["zh-CN.utf8"]) && call("档案的编码", ["zh-CN.gbk"]) !== call("档案的编码", ["zh-CN.utf8"]));
}
console.log("查编码与说法");
{
  ok("中文 GBK 那套的编码是 gbk", call("档案的编码", ["zh-CN.gbk"]) === "gbk", call("档案的编码", ["zh-CN.gbk"]));
  ok("中文 UTF-8 那套的编码是 utf8", call("档案的编码", ["zh-CN.utf8"]) === "utf8");
  ok("日文那套是 shift_jis", call("档案的编码", ["ja-JP.shift_jis"]) === "shift_jis");
  ok("英文那套是 utf8", call("档案的编码", ["en-US.utf8"]) === "utf8");
  ok("说法分别是中文、日本語、English", call("档案的说法", ["zh-CN.gbk"]) === "中文" && call("档案的说法", ["ja-JP.shift_jis"]) === "日本語" && call("档案的说法", ["en-US.utf8"]) === "English");
  ok("没有的档案返回空串，不回退", call("档案的编码", ["xx-XX.utf8"]) === "", JSON.stringify(call("档案的编码", ["xx-XX.utf8"])));
}
console.log("切换：能覆盖，也要能拒绝");
{
  ok("一开始当前档案为空（还没选过）", call("当前档案", []) === "", JSON.stringify(call("当前档案", [])));
  ok("切到中文 GBK 成功", call("切换档案", ["zh-CN.gbk"]) === "zh-CN.gbk");
  ok("当前档案就是它", call("当前档案", []) === "zh-CN.gbk", call("当前档案", []));
  ok("再切到日文", call("切换档案", ["ja-JP.shift_jis"]) === "ja-JP.shift_jis");
  ok("当前档案跟着变", call("当前档案", []) === "ja-JP.shift_jis");
  let raised = null;
  try { call("切换档案", ["xx-XX.utf8"]); } catch (e) { raised = (e.code || "") + " " + e.message; }
  ok("不存在的档案被拒绝并点名 HMYR-R0205", !!raised && raised.includes("HMYR-R0205"), String(raised));
  ok("拒绝之后当前档案没变", call("当前档案", []) === "ja-JP.shift_jis", call("当前档案", []));
}
console.log("环境说该是哪一套（可能是空，表示没档案）");
{
  const 环境 = call("环境档案", []);
  ok("返回字符串", typeof 环境 === "string", String(环境));
  ok("要么是四套之一，要么是空串", 环境 === "" || ["zh-CN.gbk", "zh-CN.utf8", "ja-JP.shift_jis", "en-US.utf8"].includes(环境), JSON.stringify(环境));
  console.log("        （本机环境给的是：" + (环境 === "" ? "空，即没有对应档案" : 环境) + "）");
}
console.log("硬规矩：档案不影响求值");
{
  // 同一段程序，在两个不同的档案下各算一次，结果必须一样。
  const src = 'fn main() -> Int { return (1 + 2) * 3 }\n';
  const d = (n) => ({ items: [], errors: [], warnings: [], add() {}, error() {}, warn() {} });
  const 算一次 = () => {
    const 求值器 = new Runtime({});
    求值器.write = () => {};
    const { ast } = parse(lex(src, { diagnostics: d() }).tokens, { diagnostics: d() });
    求值器.run(ast);
    return 求值器.callFunction(求值器.functions.get("main"), [], null);
  };
  const 旧 = call("当前档案", []);
  call("切换档案", ["zh-CN.gbk"]);
  const 甲 = 算一次();
  call("切换档案", ["en-US.utf8"]);
  const 乙 = 算一次();
  ok("两种档案下算出同一个结果", 甲 === 乙 && 甲 === 9, String(甲) + " 对 " + String(乙));
  if (旧 === "") { /* 之前没选过，就保持现在选的 */ } else { call("切换档案", [旧]); }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
