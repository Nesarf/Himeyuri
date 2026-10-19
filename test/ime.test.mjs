// 输入法预编辑的验收：组合中的文字不进缓冲区。
//
// 那条规矩的三面：
//   一、组合中改来改去，缓冲区一位都不动
//   二、定下的时候，进缓冲区的只有最后那一个
//   三、组合中按退格，删的是预编辑而不是缓冲区
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "ime.hmyr"));
ok("输入法那一层加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
rt.registerModule(loadUnit(path.join(ROOT, "shell.hmyr")).modules.values().next().value);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

console.log("一、组合中缓冲区不动");
{
  let e = call("空编辑", []);
  ok("一开始没有在组合", call("组合中", [e]) === false);
  e = call("开始", [e, "ni"]);
  ok("开始组合之后，缓冲区仍是空的", e[0] === "" && e[1] === 0, JSON.stringify(e));
  ok("而显示文本里有它", call("显示文本", [e]) === "ni");
  e = call("改写", [e, "你"]);
  ok("改写之后缓冲区还是空的", e[0] === "", JSON.stringify(e));
  ok("显示文本换成了新的", call("显示文本", [e]) === "你");
  ok("组合中为真", call("组合中", [e]) === true);
}

console.log("二、定下的时候只进最后那一个");
{
  let e = call("空编辑", []);
  e = call("开始", [e, "ni"]);
  e = call("改写", [e, "你"]);
  e = call("定下", [e]);
  ok("缓冲区里是「你」，不是「ni」", e[0] === "你", JSON.stringify(e[0]));
  ok("位进了一格", e[1] === 1, String(e[1]));
  ok("预编辑清空了", e[2] === "", JSON.stringify(e[2]));
  ok("而且没有在组合了", call("组合中", [e]) === false);
}

console.log("三、取消什么也不留");
{
  let e = call("空编辑", []);
  e = call("开始", [e, "hao"]);
  e = call("取消", [e]);
  ok("取消之后缓冲区空的、预编辑也空", e[0] === "" && e[2] === "", JSON.stringify(e));
}

console.log("四、组合中按退格删的是预编辑");
{
  let e = call("空编辑", []);
  e = call("开始", [e, "nih"]);
  e = call("退格预编辑", [e]);
  ok("预编辑少了一个字", e[2] === "ni", JSON.stringify(e[2]));
  ok("缓冲区仍然没动", e[0] === "", JSON.stringify(e[0]));
  e = call("退格预编辑", [e]);
  e = call("退格预编辑", [e]);
  ok("删空了就停在那儿，不越界", e[2] === "", JSON.stringify(e[2]));
  // 没有在组合时，退格预编辑什么都不做（不该偷偷删缓冲区）
  let f = call("空编辑", []);
  f = call("定下", [call("开始", [f, "x"])]);
  const 前 = f[0];
  f = call("退格预编辑", [f]);
  ok("没有组合时它不碰缓冲区", f[0] === 前, JSON.stringify(f));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
