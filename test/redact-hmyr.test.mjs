// 脱敏的两份实现：src/redact.mjs 与 tools/redact.hmoca。同一批消息问两边，答案必须一样。
//
// 差别只有一处，而这一套把它显式化：JS 版读一个模块级的开关，HMYR 版把开关当参数收。
// 测试里那一份先设状态再调、这一份直接传，比的仍是「同一条消息、同一个开关，交回同一个串」。
//
// 不比顺序、不比内部结构 —— 比的是文本，因为这一件的产出就是给眼睛看的文本。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { 设脱敏, 藏路径, 脱线 } from "../src/redact.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 层 = loadUnit(path.join(ROOT, "tools/redact.hmoca"));
ok("tools/redact.hmoca 加载得动", 层.ok,
  层.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
if (!层.ok) {
  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  process.exit(1);
}
const 自举 = runUnit(层);
const 叫 = (名, 参) => 自举.callFunction(自举.functions.get(名), 参, null);

// JS 版带全局开关，所以每次调用前设一次、之后还原。
const JS脱线 = (文, 开) => { 设脱敏(开); const r = 脱线(文); 设脱敏(false); return r; };
const JS藏路径 = (p, 开) => { 设脱敏(开); const r = 藏路径(p); 设脱敏(false); return r; };

// 样本按「哪里可能不一致」挑：两种引号、反斜杠、斜杠、编号、普通词、不成对的引号、
// 空串、以及一条里有多段引号的。
const 样本 = [
  "cannot read 'C:\\a\\b.txt': no such file",
  "HMYR-內-011 cannot read 'C:\\a\\b.txt'",
  "no field 'a' on that record",
  "read \"/tmp/x/y.txt\"",
  "no separator 'plain' here",
  "unpaired 'quote here",
  "two 'a/b' and 'c/d'",
  "mixed 'a\\b' then \"c/d\"",
  "",
  "no quotes at all",
  "'only/spaces here' and 'x'",
  "trailing 'a/b",
];

console.log("一、开关打开");
for (const 文 of 样本) {
  const 甲 = JS脱线(文, true);
  const 乙 = String(叫("脱线", [文, true]) || "");
  ok("  " + JSON.stringify(文), 甲 === 乙, "JS " + JSON.stringify(甲) + " / HMYR " + JSON.stringify(乙));
}

console.log("二、开关关着");
for (const 文 of 样本) {
  const 甲 = JS脱线(文, false);
  const 乙 = String(叫("脱线", [文, false]) || "");
  ok("  " + JSON.stringify(文), 甲 === 乙, "JS " + JSON.stringify(甲) + " / HMYR " + JSON.stringify(乙));
}

console.log("三、藏路径");
const 路径样本 = ["C:\\a\\b.txt", "/tmp/x/y.txt", "<path>", "", "plain.txt"];
for (const p of 路径样本) {
  for (const 开 of [true, false]) {
    const 甲 = JS藏路径(p, 开);
    const 乙 = String(叫("藏路径", [p, 开]) || "");
    ok("  " + (开 ? "开" : "关") + " " + JSON.stringify(p), 甲 === 乙,
      "JS " + JSON.stringify(甲) + " / HMYR " + JSON.stringify(乙));
  }
}

console.log("四、编号不受影响");
{
  const 文 = "HMYR-內-011 cannot read 'C:\\a\\b.txt'";
  const 乙 = String(叫("脱线", [文, true]) || "");
  ok("编号还在", 乙.includes("HMYR-內-011"), 乙);
  ok("路径已经被换掉", 乙.includes("<path>"), 乙);
  ok("原路径不在结果里", !乙.includes("C:\\a\\b.txt"), 乙);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
