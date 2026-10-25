// pattern 美化的验收：对齐、压空行、行号说出位置。
//
// 学自 openmpt/MPTPatterns。三件要验的：
//   一、列宽按最宽那一格算，于是每一列的竖线都对得上
//   二、整行只有占位符（tracker 的「空」）时，那一行不画
//   三、压掉之后行号仍留着 —— 位置由数据说，不由行序说
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "pattern.hmoca"));
ok("pattern 那一层加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

const 空 = "--- .. ... ...";
const 甲 = "C-4 01 v64 A0F";
const 乙 = "G-4 02 v48 ...";
const 丙 = "E-4 01 v64 A0F";

console.log("一、列宽按最宽那一格算");
{
  ok("最宽是十四列", call("最宽", [[甲, 空]]) === 14, String(call("最宽", [[甲, 空]])));
  const 行 = call("画一行", [[甲, 空]]);
  const 各段 = 行.split("|").filter((s) => s.length > 0);
  ok("两段都补到了十四列", 各段.length === 2 && 各段.every((s) => s.length === 15), JSON.stringify(各段.map((s) => s.length)));
}

console.log("二、占位符那一行不画");
{
  const 行们 = [[0, [甲, 空]], [1, [空, 空]], [2, [丙, 空]]];
  const 去 = call("去空行", [行们]);
  ok("三行剩下两行", 去.length === 2, String(去.length));
  ok("留下的是第零与第二行", 去[0][0] === 0 && 去[1][0] === 2, JSON.stringify(去.map((r) => r[0])));
}

console.log("三、行号说出位置");
{
  const 行们 = [[0, [甲]], [1, [空]], [2, [丙]]];
  const 出 = call("画格子表", [call("去空行", [行们])]);
  const 行们出 = 出.split("\n").filter((l) => l.length > 0);
  ok("输出只有两行", 行们出.length === 2, String(行们出.length));
  ok("第一行以 0 开头", 行们出[0].startsWith("0"), JSON.stringify(行们出[0].slice(0, 6)));
  ok("第二行以 2 开头（不是 1）", 行们出[1].startsWith("2"), JSON.stringify(行们出[1].slice(0, 6)));
}

console.log("四、空格与占位");
{
  ok("全占位的格子算空", call("空格", [空]) === true);
  ok("空串也算空", call("空格", [""]) === true);
  ok("有音符的格子不算空", call("空格", [甲]) === false);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
