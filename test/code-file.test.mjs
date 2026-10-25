// .hmyrb：程序落成一份文件，再读回来，跑出同一个答案。
//
// 这一套钉的是一件不太显眼但很硬的事：字节码与它的文件形式之间没有信息丢失。
// 如果丢了（比如字符串的某个码元、某个跳转目标、某个效果名），
// 那么将来那台不是 JS 的机器就会跟 JS 那台跑出不同的结果，而那种偏差最难查。
//
// 所以这里不只比「跑出来的值」：还逐项比函数表、指令流与常量。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
import { 写程序, 读程序, 魔数, 版本, 操作码表 } from "../src/code-file.mjs";
import { 虚拟机, 类元组, 类记录 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-codefile-"));
const 工厂 = { 元组: (项) => new 类元组(项), 记录: (字段) => new 类记录(字段) };

// 编译一份源码成一个程序对象。
const 编 = (源码) => {
  const p = path.join(临, "m" + Math.random().toString(36).slice(2) + ".hmoca");
  fs.writeFileSync(p, 源码, "utf8");
  const unit = loadUnit(p);
  if (!unit.ok) throw new Error("加载失败：" + JSON.stringify(unit.diagnostics.errors.slice(0, 2)));
  return 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));
};

// 跑一个程序，交回 main 的结果（或停机的码）。
const 跑 = (程序) => {
  let 出 = "";
  const vm = new 虚拟机(程序, { capabilities: 本机能力(), write: (s) => { 出 += s; } });
  const r = vm.调用("main", [], null);
  return r.ok ? { 值: r.值, 出 } : { 错: r.码, 出 };
};

console.log("一、文件头");
{
  const 程序 = 编('fn main() -> Int { return 1 }\n');
  const 字节 = 写程序(程序);
  ok("前五个字节是魔数", [...字节.slice(0, 5)].join(",") === 魔数.join(","), [...字节.slice(0, 5)].join(","));
  ok("版本紧接其后", (字节[5] | (字节[6] << 8)) === 版本, String(字节[5] | (字节[6] << 8)));
  ok("不是这个格式就拒绝", (() => { try { 读程序(new Uint8Array([1, 2, 3, 4, 5, 6, 7]), 工厂); return false; } catch { return true; } })());
  const 坏的 = Uint8Array.from(字节); 坏的[5] = 99;
  ok("版本不对也拒绝", (() => { try { 读程序(坏的, 工厂); return false; } catch { return true; } })());
}

console.log("二、往返之后跑出同一个答案");
{
  const 源码 = [
    "fn 加(a: Int, b: Int) -> Int {",
    "  return a + b",
    "}",
    "fn 阶(n: Int) -> Int {",
    "  if n <= 1 { return 1 }",
    "  return n * 阶(n - 1)",
    "}",
    "fn main() -> Int {",
    '  let 名 = "琥珀音"',
    "  let t = (1, 2, 3)",
    "  let r = {a: 1, b: 名}",
    "  print(名)",
    "  print(str(t[1]))",
    "  print(r.b)",
    "  print(str(阶(5)))",
    "  return 加(t[0], t[2])",
    "}",
  ].join("\n");
  const 原 = 编(源码);
  const 回 = 读程序(写程序(原), 工厂);
  const a = 跑(原), b = 跑(回);
  ok("main 的值一样", a.值 === b.值 && b.值 === 4, JSON.stringify(a.值) + " / " + JSON.stringify(b.值));
  ok("打印出来的字一样", a.出 === b.出, JSON.stringify(a.出) + " 对 " + JSON.stringify(b.出));
  // 字符串走的是码元：中文与非 BMP 字符都要原样回来。
  ok("中文字符串原样", b.出.includes("琥珀音"), JSON.stringify(b.出.slice(0, 20)));
  ok("递归的结果一样", b.出.includes("120"), JSON.stringify(b.出));
}

console.log("三、逐项比对：没有东西被丢掉");
{
  const 源码 = 'fn f(x: Int) -> Int effects(process) { return x * 2 }\nfn main() -> Int { return f(21) }\n';
  const 原 = 编(源码);
  const 回 = 读程序(写程序(原), 工厂);
  ok("函数个数一样", 原.函数们.size === 回.函数们.size, 原.函数们.size + " 对 " + 回.函数们.size);
  const 名a = [...原.函数们.keys()].sort().join(",");
  const 名b = [...回.函数们.keys()].sort().join(",");
  ok("函数名字一样", 名a === 名b, 名a + " 对 " + 名b);
  const fa = 原.函数们.get("f"), fb = 回.函数们.get("f");
  ok("参数量一样", fa.参数量 === fb.参数量);
  ok("槽数一样", fa.槽数 === fb.槽数, fa.槽数 + " 对 " + fb.槽数);
  ok("效果名一样", fa.效果.join(",") === fb.效果.join(","), fa.效果.join(",") + " 对 " + fb.效果.join(","));
  ok("指令数一样", fa.码.length === fb.码.length, fa.码.length + " 对 " + fb.码.length);
  let 同 = true, 哪 = "";
  for (let i = 0; i < Math.min(fa.码.length, fb.码.length); i++) {
    const x = fa.码[i], y = fb.码[i];
    const 同项 = x.op === y.op && JSON.stringify(x.a === undefined ? null : x.a) === JSON.stringify(y.a === undefined ? null : y.a)
      && (x.b === undefined ? null : x.b) === (y.b === undefined ? null : y.b);
    if (!同项) { 同 = false; 哪 = i + ": " + JSON.stringify(x) + " 对 " + JSON.stringify(y); break; }
  }
  ok("每条指令都一样", 同, 哪);
  // 这台机器上出现的每一种操作码都要在那张表里 —— 第 253 行那个 default 分支就是为它兜底的。
  const 出现 = new Set();
  for (const 函 of 原.函数们.values()) for (const 指令 of 函.码) 出现.add(指令.op);
  const 缺 = [...出现].filter((op) => !操作码表.includes(op));
  ok("用到的操作码都在表里", 缺.length === 0, 缺.join(","));
}

console.log("四、坏文件要被拒绝，而不是跑出怪结果");
{
  const 程序 = 编('fn main() -> Int { return 7 }\n');
  const 字节 = 写程序(程序);
  ok("截断的文件被拒绝", (() => { try { 读程序(字节.slice(0, 20), 工厂); return false; } catch { return true; } })());
  ok("空文件被拒绝", (() => { try { 读程序(new Uint8Array(0), 工厂); return false; } catch { return true; } })());
}

fs.rmSync(临, { recursive: true, force: true });
console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
