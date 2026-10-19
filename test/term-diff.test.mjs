// 帧的差异输出：只重写变了的行。
//
// 三条要验的：
//   一、两帧一样时什么都不写（空串，而不是一堆同样的字节）
//   二、只有一行变了时，别的行的内容不出现在输出里
//   三、输出里有藏光标与显光标（因为它是原地重写，不是整屏重画）
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "term.hmyr"));
ok("终端那一层加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

const 布 = (行们) => {
  let b = call("空画布", [行们.length, 6]);
  for (let i = 0; i < 行们.length; i++) b = call("换行", [b, i, 行们[i]]);
  return b;
};

console.log("一、两帧一样");
{
  const a = 布(["AAAAAA", "BBBBBB", "CCCCCC"]);
  ok("交回空串", call("画一帧差异", [a, a]) === "", JSON.stringify(call("画一帧差异", [a, a])));
}

console.log("二、只有一行变了");
{
  const a = 布(["AAAAAA", "BBBBBB", "CCCCCC"]);
  const b = 布(["AAAAAA", "ZZZZZZ", "CCCCCC"]);
  const 出 = call("画一帧差异", [a, b]);
  ok("输出不是空的", 出.length > 0, String(出.length));
  ok("变的那一行在里面", 出.indexOf("ZZZZZZ") >= 0);
  ok("没变的行不在里面", 出.indexOf("AAAAAA") < 0 && 出.indexOf("CCCCCC") < 0, JSON.stringify(出));
  ok("比整屏重画短得多", 出.length < call("画一帧", [b]).length, 出.length + " 对 " + call("画一帧", [b]).length);
}

console.log("三、它是原地重写");
{
  const a = 布(["AAAAAA", "BBBBBB"]);
  const b = 布(["AAAAAA", "ZZZZZZ"]);
  const 出 = call("画一帧差异", [a, b]);
  ok("有藏光标", 出.indexOf(call("藏光标", [])) === 0);
  ok("有显光标", 出.lastIndexOf(call("显光标", [])) === 出.length - call("显光标", []).length);
  ok("而且不是清屏（清屏会闪）", 出.indexOf(call("清屏", [])) < 0);
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
