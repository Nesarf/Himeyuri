// 量第一个数：把求值这一层换成 self/ 那一套（全 HMYR 写的 lex + parse + eval），
// 与 JS 版对着跑同一批程序，数出通过率。
//
// 这不是「换掉 src/ 之后还绿多少套」那个完整的数 —— 那个数要先把 loader 也换掉。
// 这是它的下界样本：求值这一层能对上多少。样本挑的是表达与语句都有的短程序。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { run as js跑 } from "../src/eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 样本按返回类型分两组：self/run.hmyr 的 跑程序文字 返的是 main 的返回值，
// 而 print 的输出它不接。所以样本写成 return。
const 整数样本 = ["1 + 2 * 3", "(1 + 2) * 3", "10 % 4", "7 / 2", "-5 + 3",
  "3 * 4 - 5", "8 - 3 - 2", "2 * 3 * 4", "100 / 4"];
const 布尔样本 = ["1 < 2", "2 == 2", "1 + 2 == 3", "!true", "7 > 3"];

const 包成程序 = (类型, 表达式) => "fn main() -> " + 类型 + " {\n  return " + 表达式 + "\n}\n";

const unit = loadUnit(path.join(ROOT, "self/run.hmyr"));
if (!unit.ok) {
  console.log("self/run.hmyr 加载失败：" + JSON.stringify((unit.diagnostics.errors || []).slice(0, 2).map((e) => e.code)));
  process.exit(1);
}
const rt = runUnit(unit);
const 跑程序 = (源) => rt.callFunction(rt.functions.get("跑程序文字"), [源], null);

let 对 = 0, 错 = 0;
const 明细 = [];
for (const [类型, 样本们] of [["Int", 整数样本], ["Bool", 布尔样本]]) {
  for (const 表达式 of 样本们) {
    const 源 = 包成程序(类型, 表达式);
    let 自己 = null, 宿主 = null;
    try { 自己 = String(跑程序(源)).trim(); } catch (e) { 自己 = "抛：" + String(e && e.message).slice(0, 40); }
    try {
      const r = js跑(源, {});
      宿主 = String(r.value);
      if (r.diagnostics && r.diagnostics.errors && r.diagnostics.errors.length) {
        宿主 = "诊断：" + r.diagnostics.errors[0].code;
      }
    } catch (e) { 宿主 = "抛：" + String(e && e.message).slice(0, 40); }
    const 同 = 自己 === 宿主;
    if (同) 对++; else 错++;
    明细.push((同 ? "  对  " : "  错  ") + 表达式.padEnd(20) + " 自己=" + 自己 + "  宿主=" + 宿主);
  }
}

const 总数 = 整数样本.length + 布尔样本.length;
for (const 行 of 明细) console.log(行);
console.log("");
console.log("求值这一层：对 " + 对 + " / " + 总数 + "（" + Math.round((对 / 总数) * 100) + "%）");
process.exit(错 === 0 ? 0 : 1);
