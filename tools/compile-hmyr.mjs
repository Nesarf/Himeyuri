// 用 HMYR 自己的编译器编一份源码，再落成 .hmoks。
//
// 与 tools/emit-code.mjs 的分工：那一个整条路都是 JS 的（src/bytecode.mjs 编、
// src/code-file.mjs 写），而这一个两边都用自举层那一份。
//
// 用法：node tools/compile-hmyr.mjs 入口.hmoca 输出.hmoks [--code-file]
//
// 2026-10-28 起，这条工具的最后一步也交给 HMYR 了。在那之前它是这样：
// self/compile.hmoca 编出函数表，然后 src/code-file.mjs 的 写程序 把它写成字节。
// 于是「编译器那一层还借在 JS 那边的」剩的就是这一步。现在默认走 self/pack.hmoca。
//
// 而 --code-file 保留着，因为它有一个用处：**同一个编译器、两个打包者**。
// 那一对能比出「逐字节相同」（test/pack-bytes.test.mjs 比的就是它）——
// 而两位**编译者**之间比不了逐字节：self/compile.hmoca 是子集，它编出的函数表
// 本来就比 src/bytecode.mjs 少。两个编译器之间的判据是「跑出同一个答案」，
// 那是 test/self-bridge.test.mjs 与 launcher 那几套的事。
//
// 现在的边界：self/compile.hmoca 能编的那一子集（算术、比较、字面量、按名字调用、
// return、let/var、if）。超出子集时会报「还编不了」并退出 2 —— 那比悄悄编错好。
import fs from "node:fs";
import path from "node:path";
import { loadUnit, runUnit } from "../src/loader.mjs";
import { 写程序 } from "../src/code-file.mjs";
import { 类元组, 类记录 } from "../src/vm.mjs";

const 全部参数 = process.argv.slice(2);
const 用JS落盘 = 全部参数.includes("--code-file");
const [入口, 输出] = 全部参数.filter((a) => !a.startsWith("--"));
if (!入口 || !输出) {
  console.error("用法：node tools/compile-hmyr.mjs 入口.hmoca 输出.hmoks [--code-file]");
  process.exit(2);
}

const 根 = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

const 编 = runUnit(loadUnit(path.join(根, "self/compile.hmoca")), { stage0: true, stepLimit: 300000000 });
const 编源码 = 编.functions.get("编源码");

// 源码要按 import 链拼起来再交给编译器：它只认「一份源码」，
// 而一份程序常常是几份文件。顺序照 loader 交出来的依赖顺序 —— 被依赖的在前，
// 于是函数表里先到的那一份赢，与 JS 那边 合并程序 的规矩一致。
const 入口路 = path.resolve(入口);
const unit = loadUnit(入口路);
let 源码 = "";
if (unit.ok) {
  for (const 文件 of unit.order) 源码 += fs.readFileSync(文件, "utf8") + "\n";
} else {
  源码 = fs.readFileSync(入口路, "utf8");
}
const r = 编.callFunction(编源码, [源码], null);
if (!r || r.ok === false) {
  console.error("HMYR 编译器： " + (r ? r.错 : "没有交回值"));
  process.exit(2);
}

let 字节;
if (用JS落盘) {
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
  字节 = 写程序({ 函数们, 全局们: [] });
} else {
  // 落盘：把编出来的函数表直接交给自举层的打包者。它交回的是「块们」——
  // 攒够 512 字节封一块，于是那一层不必每一步都复制已累积的全部内容。
  const 装 = runUnit(loadUnit(path.join(根, "self/pack.hmoca")), { stage0: true, stepLimit: 300000000 });
  const 块们 = 装.callFunction(装.functions.get("打包"), [r.函数们], null);
  if (!块们) {
    console.error("HMYR 打包者：没有交回字节");
    process.exit(2);
  }
  const 字节们 = [];
  for (const 块 of 块们) for (const b of 块) 字节们.push(b & 0xff);
  字节 = Uint8Array.from(字节们);
}

fs.writeFileSync(path.resolve(输出), 字节);
let 指令数 = 0;
for (const f of r.函数们) 指令数 += (f.码 || []).length;
console.log("HMYR 编译器：" + r.函数们.length + " 个函数，" + 指令数 + " 条指令，" +
  字节.length + " 字节（" + (用JS落盘 ? "code-file 落盘" : "pack 落盘") + "）→ " + 输出);
