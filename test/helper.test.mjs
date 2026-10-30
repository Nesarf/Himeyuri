// 助手的验收：给编号就说清，给词就搜，搜不到不空手。
//
// 它建在 conformance/codes.mjs 上，所以这一套真正查的是两件事：
// 一、它读得对吧里每一行都读到了；二、它不凭空造编号。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  // 分组从「E / R / W 三组」改成「八层」：2026-11-02 换码之后编号说的是层，
  // 而严重程度不再进码 —— 所以这一条改成「层名都得出现」。
  ok("八层里该出现的都出现", r.stdout.includes("词法") && r.stdout.includes("语法")
    && r.stdout.includes("装载") && r.stdout.includes("运行时") && r.stdout.includes("内置"), r.stdout.slice(0, 120));
}

console.log("二、给一个真编号");
{
  const r = 跑("HMYR-行-010");
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
  ok("在英文含义里找得到", r.status === 0 && r.stdout.includes("HMYR-行-009"), r.stdout.slice(0, 80));
  const 空 = 跑("完全不存在的词xyz");
  ok("找不到时不空手回去", 空.stdout.includes("全部编号"), 空.stdout.slice(0, 60));
}

console.log("");
console.log("五、中文人话那一份与编号表对得上");
{
  const 取 = (p) => Array.from(new Set(Array.from(fs.readFileSync(path.join(ROOT, p), "utf8").matchAll(/HMYR-[^\s"]+/g)).map((m) => m[0]))).sort();
  const 甲 = 取("conformance/codes.mjs");
  const 乙 = 取("conformance/plain.mjs");
  // 这个数跟着编号表走：索引那一组补了 HMYR-內-018 与 HMYR-內-019。
  ok("两个文件的编号一样多（至少六十）", 甲.length === 乙.length && 甲.length >= 60, 甲.length + " 对 " + 乙.length);
  const 缺 = 甲.filter((c) => !乙.includes(c));
  const 多 = 乙.filter((c) => !甲.includes(c));
  ok("一个不缺", 缺.length === 0, 缺.slice(0, 4).join(" "));
  ok("一个不多（多一句就是谎）", 多.length === 0, 多.slice(0, 4).join(" "));
  // 顺带：中文那一份里每一句都该是真的中文，而不是英文占位
  const { PLAIN } = await import(pathToFileURL(path.join(ROOT, "conformance/plain.mjs")).href);
  const 空的 = Object.entries(PLAIN).filter(([, v]) => !v || v.length < 6);
  ok("没有空的或过短的句子", 空的.length === 0, JSON.stringify(空的.slice(0, 2)));
  const 英文的 = Object.entries(PLAIN).filter(([, v]) => !/[\u4e00-\u9fff]/.test(v));
  ok("每一句都含中文（没有拿英文占位）", 英文的.length === 0, JSON.stringify(英文的.slice(0, 2)).slice(0, 80));
}

console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
