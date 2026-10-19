// 退格与删除按「字」算，不按码位。
//
// 为什么这不是细节：组合字符在码位上是两个、在屏幕上是一个字。
// 只删一个码位会留下一个孤零零的重音符，它粘到前面那个字上——
// 用户看到的是「屏幕自己变了」，而代码里没有任何一步出错。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const unit = loadUnit(path.join(ROOT, "shell.hmyr"));
ok("shell 那一层加载得动", unit.ok, unit.diagnostics.errors.map((e) => e.code + " " + e.message).join("; "));
const rt = runUnit(unit);
const call = (name, args) => {
  const fn = rt.functions.get(name);
  if (!fn) throw new Error("没有这个函数：" + name);
  return rt.callFunction(fn, args, null);
};
const 打 = (文本) => {
  let s = call("空状态", []);
  for (const ch of 文本) s = call("插入", [s, ch]);
  return s;
};

const 组合 = "e" + String.fromCharCode(0x0301);
const 单码位 = "é";

console.log("一、普通字符照旧");
{
  let s = 打("abc");
  s = call("退格", [s]);
  ok("abc 退一格得 ab", s[0] === "ab" && s[1] === 2, s[0] + " · " + s[1]);
  s = call("删除", [s]);
  ok("ab 删一格（光标在末尾）不变", s[0] === "ab", s[0]);
}

console.log("二、组合字整个删掉");
{
  const s0 = 打(组合);
  ok("组合字在码位上是二", s0[0].length === 2, String(s0[0].length));
  const s1 = call("退格", [s0]);
  ok("退一格之后整个字都没了", s1[0] === "" && s1[1] === 0, JSON.stringify(s1[0]) + " · " + s1[1]);
  ok("而且没有留下孤零零的重音符", s1[0].indexOf(String.fromCharCode(0x0301)) < 0);
}

console.log("三、单码位的 é 也照删");
{
  const s0 = 打(单码位);
  ok("单码位的 é 是码位一", s0[0].length === 1, String(s0[0].length));
  const s1 = call("退格", [s0]);
  ok("退一格之后没了", s1[0] === "" && s1[1] === 0, JSON.stringify(s1[0]));
}

console.log("四、删除也按字");
{
  // 光标停在组合字之前，按 Del 该把整个字删掉
  let s = 打(组合);
  s = call("左移", [s]);
  s = call("左移", [s]);
  ok("光标回到最前", s[1] === 0, String(s[1]));
  const s2 = call("删除", [s]);
  ok("Del 一次删掉整个字", s2[0] === "" && s2[1] === 0, JSON.stringify(s2[0]));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
