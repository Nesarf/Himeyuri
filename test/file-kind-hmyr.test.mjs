// 一个后缀算源码还是字节码：两份实现，一份判据。
//
// tools/file-kind-reference.mjs 与 tools/file-kind.hmoca 是同一件事的两种写法。这一套拿
// 同一批名字问两边，答案必须逐项一样。它跑在 JS 那一侧（不编 C 机器），因为这一份 HMYR
// 什么都不 import，装载它不需要机器 —— 那也让这一套在任何机器上都能跑。
//
// 前者名字里的 reference 是这一套存在的原因：生产代码只问 HMYR 那一份，而这一份留着
// 当对照的另一头。改了一边而另一边没动，这里会红。
//
// 为什么值得专门钉住：这个判断被八处调用方共用（bin/hmyr.mjs、manifest、package、
// self-bridge、self-loader、impact、check-builtins、profile 那套）。它一旦悄悄改了口径，
// 八个地方会各自以为自己是对的，而没有任何一处会报错。
//
// 空串那一条不是凑数：JS 版先做 String(名 || "")，所以 undefined 与空串都落到「不是源码」。
// HMYR 里没有 null，空串是这一层最接近「没有」的东西 —— 两边在这一点上必须一致。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";
import * as JS版 from "../tools/file-kind-reference.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 层 = loadUnit(path.join(ROOT, "tools/file-kind.hmoca"));
ok("tools/file-kind.hmoca 加载得动", 层.ok,
  层.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
if (!层.ok) {
  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  process.exit(1);
}
const 自举 = runUnit(层);
const 叫 = (名, 参) => 自举.callFunction(自举.functions.get(名), 参, null);

// 样本按「为什么要试它」排，不按字母排。
const 样本 = [
  "a.hmoca",            // 最常见的源码
  "A.HMOCA",            // 大写：两侧都按小写比
  "design/SPEC.txt",    // 不是源码也不是字节码
  "x.hmoks",            // 字节码
  "pack.hmtn",          // 种子，也是字节码
  "run.seed.hmtn",      // 种子的另一种写法
  "e.hmsnp",            // 两档入口，算源码
  "f.hmhsr",            // 另一档
  "F.HMHSR",            // 大写的那一档
  "",                   // 空串
  "noext",              // 没有扩展名
  ".hmoca",             // 只有扩展名
  "dir.hmoca/",         // 结尾是斜杠：不是以 .hmoca 结尾
  "a.hmoca.bak",        // 备份名：不是源码
  "b.bak.hmoca",        // 备份之后又改回源码名：算源码
  "x.hmyrb",            // 旧名，改完之后不认
  "y.hmyr",             // 旧名
];

console.log("一、是源码（" + 样本.length + " 个样本）");
for (const 名 of 样本) {
  const 甲 = JS版.是源码(名);
  const 乙 = 叫("是源码", [名]);
  ok("  " + JSON.stringify(名), 甲 === 乙, "JS " + JSON.stringify(甲) + " / HMYR " + JSON.stringify(乙));
}

console.log("二、是字节码");
for (const 名 of 样本) {
  const 甲 = JS版.是字节码(名);
  const 乙 = 叫("是字节码", [名]);
  ok("  " + JSON.stringify(名), 甲 === 乙, "JS " + JSON.stringify(甲) + " / HMYR " + JSON.stringify(乙));
}

console.log("三、是种子");
for (const 名 of 样本) {
  const 甲 = JS版.是种子(名);
  const 乙 = 叫("是种子", [名]);
  ok("  " + JSON.stringify(名), 甲 === 乙, "JS " + JSON.stringify(甲) + " / HMYR " + JSON.stringify(乙));
}

console.log("四、档位与档步限");
for (const 名 of 样本) {
  // JS 版没有档位时交回 null，HMYR 版交回空串 —— 归一之后才比得。
  const 档甲 = String(JS版.档位(名) ?? "");
  const 档乙 = String(叫("档位", [名]) ?? "");
  ok("  档位 " + JSON.stringify(名), 档甲 === 档乙, "JS " + JSON.stringify(档甲) + " / HMYR " + JSON.stringify(档乙));
  const 限甲 = JS版.档步限(名);
  const 限乙 = 叫("档步限", [名]);
  ok("  档步限 " + JSON.stringify(名), 限甲 === 限乙, "JS " + 限甲 + " / HMYR " + 限乙);
}

console.log("五、后缀清单");
const 源甲 = JS版.全部源码后缀().join(",");
const 源乙 = Array.from(叫("全部源码后缀", []) || []).join(",");
ok("全部源码后缀 相同", 源甲 === 源乙, "JS " + 源甲 + " / HMYR " + 源乙);
const 码甲 = JS版.全部字节码后缀().join(",");
const 码乙 = Array.from(叫("全部字节码后缀", []) || []).join(",");
ok("全部字节码后缀 相同", 码甲 === 码乙, "JS " + 码甲 + " / HMYR " + 码乙);

console.log("六、整批问");
// 整批入口交回的是换行分隔的一串 —— 与逐个问的结果必须一样，顺序也一致。
const 清单 = 样本.filter((n) => n.length > 0);
const 批甲 = 清单.filter((n) => JS版.是源码(n)).join("\n");
const 批乙 = String(叫("只留源码", [清单.join("\n")]) || "").split("\n").filter(Boolean).join("\n");
ok("只留源码 交回同一份清单（" + 批甲.split("\n").filter(Boolean).length + " 个）", 批甲 === 批乙,
  "JS " + JSON.stringify(批甲) + " / HMYR " + JSON.stringify(批乙));
ok("空串交回空串", String(叫("只留源码", [""]) || "") === "", JSON.stringify(叫("只留源码", [""])));
ok("整批里一个都不合就交回空串", String(叫("只留源码", ["design/SPEC.txt\nnoext"]) || "") === "",
  JSON.stringify(叫("只留源码", ["design/SPEC.txt\nnoext"])));
ok("逐行判断与逐个判断同源", 批甲 === 清单.filter((n) => JS版.是源码(n)).join("\n"));

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
