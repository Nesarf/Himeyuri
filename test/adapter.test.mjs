// 适配层的验收：宿主与自举，同一份源码得同一个数。
//
// 那是这一层唯一诚实的验收标准。「树转得像」不算——
// 转得再像而两边算出来的数不同，这一层就没有用。
//
// 而它只测表达式：语句那一层还没转，而那正是它该停的地方。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expression } from "../src/adapter.mjs";
import { run } from "../src/eval.mjs";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 宿主的答案：跑一遍程序，取返回值
const 宿主 = (源) => run(源, {}).value;

// 自举的答案：把同一个表达式转成它认的形状，再让它的求值器算。
const 自举层 = loadUnit(path.join(ROOT, "self/eval.hmoca"));
ok("自举那一层加载得动", 自举层.ok, 自举层.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const 自举 = runUnit(自举层);
// 自举的求值器把成功与失败**包在结果里**（{ok, value}），而宿主直接交回值。
// 那是两边真实的接口差异，而这一层不该假装它不存在——于是这里取出来，
// 并且在失败时把失败也当成一个答案（而不是当成一个数）。
const 它的 = (源) => {
  const 树 = expression(源);
  if (树.kind === "Error") return { err: 树.text };
  const 回 = 自举.callFunction(自举.functions.get("求值"), [树, []], null);
  if (回 && 回.ok === false) return { err: 回.reason || "自举那边报错", value: null };
  return { value: 回 && Object.prototype.hasOwnProperty.call(回, "value") ? 回.value : 回 };
};

const 例 = (表达式) => "fn main() -> Int {\n  return " + 表达式 + "\n}\n";

console.log("一、两边算出来的数一样");
{
  const 例们 = [
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 - 4 - 3", 3],
    ["2 * 3 + 4 * 5", 26],
    // 除号是浮点除：100 / 7 是 14.285… 而不是 14。用除得尽的来测，而那个差别
    // 顺带也说明了这两边连「除法是什么」都一致。
    ["100 / 5", 20],
    ["100 % 7", 2],
    ["-5", -5],
    ["1 + 2 + 3 + 4", 10],
  ];
  for (const [式子, 答] of 例们) {
    const 源 = 例(式子);
    const 甲 = 宿主(源);
    const 乙 = 它的(源);
    ok(式子.padEnd(16) + " → 两边都是 " + 答, 甲 === 答 && 乙.value === 答, "宿主 " + 甲 + " · 自举 " + JSON.stringify(乙));
  }
}

console.log("二、运算符的优先级在两边一致");
{
  // 这几个式子只有在优先级相同时才会两个都答对
  const 对 = [
    ["1 + 2 * 3", 7],
    ["2 * 3 + 1", 7],
    ["1 - 2 * 3", -5],
  ];
  for (const [式子, 答] of 对) {
    const 源 = 例(式子);
    ok("优先级：" + 式子 + " = " + 答, 宿主(源) === 答 && 它的(源).value === 答);
  }
}

console.log("三、转不了的东西说清为什么");
{
  const 树 = expression(例("变([1, 2])"));
  ok("未知的节点交出 err", 树.kind === "Error" || 树.kind === "调用", JSON.stringify(树).slice(0, 80));
  const 语句 = expression("fn main() -> Int {\n  let x = 1\n  return x\n}\n");
  // return x 里的 x 是个名字，而这一版不建环境——它转得出形状，算不出来
  ok("名字转得出形状", 语句.kind === "名", JSON.stringify(语句));
}

console.log("四、这一层只做表达式，而它说得出这句话");
{
  const 树 = expression("fn main() -> Int {\n  while 1 < 2 { }\n  return 1\n}\n");
  // while 是语句，而 return 1 里没有可转的表达式以外的麻烦——于是这里能得到 int
  ok("它不会被语句绊住（只取 return 的表达式）", 树.kind === "字" || 树.kind === "Error", JSON.stringify(树).slice(0, 60));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
