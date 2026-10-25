// 用 HMYR 自己的编译器编一份源码，落成 .hmyrb。
//
// 与 tools/emit-code.mjs 的分工：那一个用 JS 的编译器（src/bytecode.mjs），
// 这一个用 self/compile.hmyr。同一个程序交给两位编译者，产出的字节码若跑出
// 同一个答案，就说明搬过来的那一部分是真的。
//
// 用法：node tools/compile-hmyr.mjs 入口.hmyr 输出.hmyrb
//
// 现在的边界：self/compile.hmyr 能编的那一子集（算术、比较、字面量、按名字调用、
// return、let/var、if）。超出子集时会报「还编不了」并退出 2 —— 那比悄悄编错好。
import fs from "node:fs";
import path from "node:path";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { 写程序 } from "../src/code-file.mjs";
import { 类元组, 类记录 } from "../src/vm.mjs";

const [入口, 输出] = process.argv.slice(2);
if (!入口 || !输出) {
  console.error("用法：node tools/compile-hmyr.mjs 入口.hmyr 输出.hmoks");
  process.exit(2);
}

const 根 = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const rt = runUnit(loadUnit(path.join(根, "self/compile.hmoca")), { stage0: true, stepLimit: 300000000 });
const 编源码 = rt.functions.get("编源码");

// 源码要按 import 链拼起来再交给编译器：它只认「一份源码」，
// 而一份程序常常是几份文件。顺序照 loader 交出来的依赖顺序 —— 被依赖的在前，
// 于是函数表里先到的那一份赢，与 JS 那边 合并程序 的规矩一致。
const 入口路 = path.resolve(入口);
const unit = loadUnit(入口路);
let 源码 = "";
if (unit.ok) {
  for (const 文件 of unit.order) 源码 += fs.readFileSync(文件, "utf8") + "\n";
} else {
  // 加载失败也照样试一次单文件：有些程序没有 import，而 loadUnit 对它们
  // 仍可能因为别的原因报诊断。
  源码 = fs.readFileSync(入口路, "utf8");
}
const r = rt.callFunction(编源码, [源码], null);
if (!r || r.ok === false) {
  console.error("HMYR 编译器： " + (r ? r.错 : "没有交回值"));
  process.exit(2);
}

// 宿主那边的值与 写程序 认的值差一层：HMYR 的元组在 JS 里是数组。
const 转值 = (v) => {
  if (Array.isArray(v)) return new 类元组(v.map(转值));
  if (v && typeof v === "object" && v.fields instanceof Map) {
    const 字段 = new Map();
    for (const [k, x] of v.fields) 字段.set(k, 转值(x));
    return new 类记录(字段);
  }
  return v;
};

const 函数们 = new Map();
for (const f of r.函数们) {
  函数们.set(f.名, {
    名: f.名,
    参数量: f.参数量,
    槽数: f.槽数,
    效果: Array.from(f.效果 || []),
    码: Array.from(f.码 || []).map((i) => {
      const 指令 = { op: i.op };
      // RECORD 的立即数是**字符串数组**（写文件时按 n 个名字落盘），
      // 不是语言里的元组值 —— 所以它不走 转值。
      if (i.op === "RECORD") 指令.a = Array.from(i.a || []);
      else if (i.a !== undefined) 指令.a = 转值(i.a);
      if (i.b !== undefined) 指令.b = i.b;
      return 指令;
    }),
  });
}

const 字节 = 写程序({ 函数们, 全局们: [] });
fs.writeFileSync(path.resolve(输出), 字节);
const 指令数 = [...函数们.values()].reduce((n, f) => n + f.码.length, 0);
console.log("HMYR 编译器：" + 函数们.size + " 个函数，" + 指令数 + " 条指令，" + 字节.length + " 字节 → " + 输出);
