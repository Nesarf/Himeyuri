// 助手的验收：给编号就说清，给词就搜，搜不到不空手。
//
// 它建在 conformance/codes.mjs 上，所以这一套真正查的是两件事：
// 一、它读得对吧里每一行都读到了；二、它不凭空造编号。
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};
const 跑 = (...参) => spawnSync(process.execPath, [path.join(ROOT, "tools/helper.mjs"), ...参], { encoding: "utf8" });

console.log("一、不给参数：列出全部");
{
  const r = 跑();
  ok("跑得动", r.status === 0, String(r.status));
  ok("说了共多少个编号", /共 \d+ 个编号/.test(r.stdout), r.stdout.slice(0, 40));
  ok("三组都出现", r.stdout.includes("编译期") && r.stdout.includes("运行期") && r.stdout.includes("警告"));
}

console.log("二、给一个真编号");
{
  const r = 跑("HMYR-R0110");
  ok("退出码零", r.status === 0, String(r.status));
  ok("说得出阶段", r.stdout.includes("求值"), r.stdout.slice(0, 60));
  ok("说得出含义", r.stdout.includes("node kind") || r.stdout.includes("含义"), r.stdout.slice(0, 80));
  ok("说得出怎么办", r.stdout.includes("怎么办"));
  ok("而且标出它是实现内部的", r.stdout.includes("实现内部的故障"));
}

console.log("三、给一个假编号");
{
  const r = 跑("HMYR-R9999");
  ok("退出码非零（它该说自己不知道）", r.status !== 0, String(r.status));
  ok("明确说没有这个编号", r.stdout.includes("没有这个编号"), r.stdout.slice(0, 60));
}

console.log("四、给一个词");
{
  const r = 跑("depth");
  ok("在英文含义里找得到", r.status === 0 && r.stdout.includes("HMYR-R0108"), r.stdout.slice(0, 80));
  const 空 = 跑("完全不存在的词xyz");
  ok("找不到时不空手回去", 空.stdout.includes("全部编号"), 空.stdout.slice(0, 60));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
