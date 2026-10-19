// 三个新场景的验收：波浪、雨、字幕。
//
// 每个场景都是「画布与帧号进、新画布出」的纯函数，所以能被逐帧断言——
// 这是 term 这条线从第一天就定下的规矩。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const rt = runUnit(loadUnit(path.join(ROOT, "term.hmyr")));
rt.registerModule(loadUnit(path.join(ROOT, "glyphs.hmyr")).modules.values().next().value);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};
const 布 = (行, 列) => call("空画布", [行, 列]);
const 叠 = (画布, 栈, 帧) => call("叠", [画布, 栈, 帧]);
const 数记号 = (画布, 记号) => 画布.join("").split(记号).length - 1;

console.log("波浪：三行交替，逐帧移动");
{
  const 甲 = 叠(布(3, 9), ["波浪"], 0);
  const 乙 = 叠(布(3, 9), ["波浪"], 1);
  ok("三行上都有波浪记号", 甲.every((l) => l.includes("~")), JSON.stringify(甲));
  ok("每一列恰好一个记号（九列九个）", 数记号(甲, "~") === 9, String(数记号(甲, "~")));
  ok("逐帧移动（相邻帧不同）", JSON.stringify(甲) !== JSON.stringify(乙), JSON.stringify(甲[0]) + " / " + JSON.stringify(乙[0]));
  const 丙 = 叠(布(3, 9), ["波浪"], 3);
  ok("周期是三（第 3 帧与第 0 帧相同）", JSON.stringify(甲) === JSON.stringify(丙));
  ok("画布太矮时不崩，原样交回", JSON.stringify(叠(布(2, 9), ["波浪"], 0)) === JSON.stringify(布(2, 9)));
}

console.log("雨：四滴，各有落点");
{
  const 甲 = 叠(布(8, 20), ["雨"], 0);
  ok("四滴都在画布上", 数记号(甲, "|") === 4, String(数记号(甲, "|")));
  const 乙 = 叠(布(8, 20), ["雨"], 1);
  ok("逐帧下移（落点变了）", JSON.stringify(甲) !== JSON.stringify(乙));
  {
    // 第一滴的落点应当是 (帧号 + 0) 对行数取余
    const 行0 = 甲.findIndex((l) => l.indexOf("|") === 0);
    ok("第一滴在它自己那一列的第 0 列", 行0 === 0, String(行0));
  }
  ok("窄画布不崩", JSON.stringify(叠(布(8, 1), ["雨"], 0)).length >= 1);
}

console.log("字幕：从右进来，往左走出去");
{
  // 第 0 帧时起点正好等于画布宽，字幕还在画面外——那是设计如此，所以挑第 5 帧来看。
  const 甲 = 叠(布(3, 20), ["字幕"], 5);
  ok("第 5 帧时文字出现在最后一行（放得下前五个字）", 甲[2].includes("HIMEY"), JSON.stringify(甲[2]));
  const 乙 = 叠(布(3, 20), ["字幕"], 9);
  ok("逐帧左移（起点不同）", 甲[2] !== 乙[2], JSON.stringify(甲[2]) + " / " + JSON.stringify(乙[2]));
  const 丙 = 叠(布(3, 20), ["字幕"], 30);
  ok("走出画面之后也不崩（贴行只管消费片段）", typeof 丙[2] === "string" && 丙[2].length === 20, String(丙[2].length));
}

console.log("三层一起叠：后画的盖住先画的");
{
  const 画 = 叠(布(5, 20), ["雨", "字幕", "点"], 5);
  ok("依旧五行、每行二十列", 画.length === 5 && 画.every((l) => l.length === 20), JSON.stringify(画.map((l) => l.length)));
  ok("雨在里面", 数记号(画, "|") >= 1);
  ok("字幕在里面（第 5 帧，放得下前五个字）", 画.join("").includes("HIMEY"));
  ok("点在里面", 画.join("").includes("*"));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
