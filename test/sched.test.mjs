// 调度器的验收：轮流、完成、取消、失败。
//
// 它不跑任务，所以这些都能逐轮断言——「交错推进」在这门语言里是调用方按轮转顺序做的事，
// 而调度器只回答「下一个是谁」与「跑完一步怎么记」。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "sched.hmoca"));
ok("调度器加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

console.log("空轮与加任务");
{
  const 空 = call("空轮", []);
  ok("空轮没有任务", call("任务数", [空]) === 0);
  ok("空轮的下一个是 -1（没有可跑的）", call("下一个", [空]) === -1);
  ok("空轮的剩余是零", call("剩余", [空]) === 0);
}

console.log("轮转：记一步就换下一个");
{
  let 轮 = call("空轮", []);
  轮 = call("加", [轮, "甲"]);
  轮 = call("加", [轮, "乙"]);
  ok("两个任务", call("任务数", [轮]) === 2);
  ok("第一个该轮到甲", call("名字", [轮, call("下一个", [轮])]) === "甲");
  const 位甲 = call("下一个", [轮]);
  轮 = call("记", [轮, 位甲, "甲的状态", false, false]);
  ok("甲记一步之后轮到乙", call("名字", [轮, call("下一个", [轮])]) === "乙", call("名字", [轮, call("下一个", [轮])]));
  ok("甲的步数是一", call("步数", [轮, 位甲]) === 1);
  ok("甲的状态交得出来", call("状态", [轮, 位甲]) === "甲的状态");
  const 位乙 = call("下一个", [轮]);
  轮 = call("记", [轮, 位乙, "乙的状态", false, false]);
  ok("乙记一步之后又回到甲", call("名字", [轮, call("下一个", [轮])]) === "甲");
}

console.log("完成：完成的那个不再被轮到");
{
  let 轮 = call("空轮", []);
  轮 = call("加", [轮, "甲"]);
  轮 = call("加", [轮, "乙"]);
  轮 = call("记", [轮, 0, "x", true, false]);
  ok("甲完成之后下一个是乙", call("名字", [轮, call("下一个", [轮])]) === "乙", call("名字", [轮, call("下一个", [轮])]));
  ok("剩余是一", call("剩余", [轮]) === 1);
  ok("甲读作已完成", call("完成了", [轮, 0]) === true);
  const 位乙 = call("下一个", [轮]);
  轮 = call("记", [轮, 位乙, "y", true, false]);
  ok("都完成之后下一个是 -1", call("下一个", [轮]) === -1);
  ok("剩余是零", call("剩余", [轮]) === 0);
  ok("而任务仍在（完成不等于消失）", call("任务数", [轮]) === 2);
}

console.log("取消与失败");
{
  let 轮 = call("空轮", []);
  轮 = call("加", [轮, "甲"]);
  轮 = call("加", [轮, "乙"]);
  轮 = call("取消", [轮, 0]);
  ok("取消之后甲读作完成", call("完成了", [轮, 0]) === true);
  ok("下一个跳过甲，轮到乙", call("名字", [轮, call("下一个", [轮])]) === "乙");
  ok("取消的那一个不算失败", call("失败了吗", [轮, 0]) === false);
}
{
  let 轮 = call("空轮", []);
  轮 = call("加", [轮, "甲"]);
  轮 = call("加", [轮, "乙"]);
  轮 = call("记", [轮, 0, "x", true, true]);
  ok("失败照实记着", call("失败了吗", [轮, 0]) === true);
  ok("而别的任务照旧（失败不连坐）", call("名字", [轮, call("下一个", [轮])]) === "乙");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
