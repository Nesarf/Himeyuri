// 窗口即任务的验收：任务树的纯数据形状。
//
// 它验的是 design/WINDOWS.txt 那三条硬规矩里的前两条：
//   ①子窗口只能作为主窗口的子任务创建，不许游离
//   ②一个子窗口崩了不带走主窗口（失败去向可查）
// 以及 CONCURRENCY.txt 2.1 的「取消父任务即取消整棵子树」。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "task.hmyr"));
ok("任务树加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

// 造一棵固定的树：主窗口(0) → A(1) → A 的面板(3)；主窗口 → B(2)
const 树 = (() => {
  let t = call("空树", []);
  t = call("挂", [t, "主窗口", -1]);
  t = call("挂", [t, "子窗口 A", 0]);
  t = call("挂", [t, "子窗口 B", 0]);
  t = call("挂", [t, "A 的面板", 1]);
  return t;
})();

console.log("建树");
ok("四个任务", call("任务数", [树]) === 4, String(call("任务数", [树])));
ok("根的名字是主窗口", call("名字", [树, 0]) === "主窗口");
ok("A 的父是主窗口", call("父", [树, 1]) === 0);
ok("A 的面板的父是 A", call("父", [树, 3]) === 1);
ok("根的父是 -1（它没有父）", call("父", [树, 0]) === -1);

console.log("子树：父收子，子收孙");
ok("从主窗口看是整棵树", JSON.stringify(call("子树", [树, 0])) === JSON.stringify([0, 1, 2, 3]), JSON.stringify(call("子树", [树, 0])));
ok("从 A 看是它自己加它的面板", JSON.stringify(call("子树", [树, 1])) === JSON.stringify([1, 3]), JSON.stringify(call("子树", [树, 1])));
ok("从 B 看只有它自己", JSON.stringify(call("子树", [树, 2])) === JSON.stringify([2]));
ok("从叶子的面板看也只有它自己", JSON.stringify(call("子树", [树, 3])) === JSON.stringify([3]));

console.log("取消：父没了，子也不能留着");
{
  const 剩 = call("取消", [树, 1]);
  ok("取消 A 之后剩两个（主窗口与 B）", call("任务数", [剩]) === 2, String(call("任务数", [剩])));
  ok("剩下的名字对", call("名字", [剩, 0]) === "主窗口" && call("名字", [剩, 1]) === "子窗口 B", JSON.stringify([call("名字", [剩, 0]), call("名字", [剩, 1])]));
}
{
  // 最要紧的一条：关主窗口就是取消整棵树
  const 剩 = call("取消", [树, 0]);
  ok("取消主窗口之后一个不剩", call("任务数", [剩]) === 0, String(call("任务数", [剩])));
}
{
  const 剩 = call("取消", [树, 3]);
  ok("取消一个叶子，别的都在", call("任务数", [剩]) === 3, String(call("任务数", [剩])));
}

console.log("不许游离：父不存在就挂不上");
{
  const t = call("挂", [树, "孤儿", 99]);
  ok("父不存在时树不变", call("任务数", [t]) === 4, String(call("任务数", [t])));
}

console.log("失败去向：默认传播给父");
ok("面板的失败先到这里", call("失败去向", [树, 3]) === 1);
ok("子窗口的失败回到主窗口", call("失败去向", [树, 1]) === 0);
ok("主窗口的失败没有父（交给接住的人）", call("失败去向", [树, 0]) === -1);

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
