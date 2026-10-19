// 并行的验收：同时起几件事，而判定仍回到语言里做。
//
// 并行发生在那个子进程里（见 design/CONCURRENCY.txt 的补记），
// 所以这里验的是「结果完整、对应关系清楚、能被 json.hmyr 读出来」。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "parallel.hmyr"));
ok("并行那一层加载得动（这一句顺带确认没有半加载）", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
rt.registerModule(loadUnit(path.join(ROOT, "json.hmyr")).modules.values().next().value);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};

console.log("两条命令同时跑");
{
  const r = call("并行跑", [["cmd /c \"echo one\"", "cmd /c \"echo two\""], 20]);
  ok("跑通了", r.ok === true, JSON.stringify(String(r.text).slice(0, 80)));
  ok("结果不是空", String(r.text).length > 10);
  // 交给语言自己的 JSON 解析器
  const 树 = call("解析", [r.text])[0];
  ok("json.hmyr 读得动这份结果", 树.kind === "o", JSON.stringify(树).slice(0, 60));
  const 条 = call("字段", [树, "items"]);
  ok("里面有 items", 条.kind === "a", JSON.stringify(条).slice(0, 40));
  ok("两条都在", 条.value.length === 2, String(条.value.length));
  const 甲 = 条.value[0];
  const 状态 = call("字段", [甲, "state"]);
  ok("第一条说 Completed", 状态.kind === "s" && 状态.value === "Completed", JSON.stringify(状态));
  const 命令 = call("字段", [甲, "cmd"]);
  ok("而且说得出是哪条命令", 命令.kind === "s" && 命令.value.indexOf("echo one") >= 0, JSON.stringify(命令).slice(0, 50));
  const 输出 = call("字段", [甲, "output"]);
  ok("输出也在", 输出.kind === "s" && 输出.value.indexOf("one") >= 0, JSON.stringify(输出).slice(0, 40));
}

console.log("边角");
{
  // JS 里的 () 不是空元组，是空括号——宿主侧要写 []。
  const 空 = call("并行跑", [[], 5]);
  ok("空列表不崩（脚本会报零条）", 空.ok === true, JSON.stringify(String(空.text).slice(0, 60)));
  const 一条 = call("并行跑", [["cmd /c \"echo solo\""], 10]);
  const 树 = call("解析", [一条.text])[0];
  const 条 = call("字段", [树, "items"]);
  ok("一条时形状仍然是数组（不是对象）", 条.kind === "a" && 条.value.length === 1, JSON.stringify(条).slice(0, 50));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
