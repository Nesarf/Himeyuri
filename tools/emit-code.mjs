// 把一份 .hmyr 编成 .hmyrb。
//
// 用法：node tools/emit-code.mjs 入口.hmyr 输出.hmyrb
//
// 这一件存在的理由是「那台不是 JS 的机器」：它要执行的东西得先落在文件里。
// 与它配套的是 src/code-file.mjs（格式）与将来那份 C 读法。
import fs from "node:fs";
import path from "node:path";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序, 核对返回类型 } from "../src/bytecode.mjs";
import { 写程序 } from "../src/code-file.mjs";

const [入口, 输出] = process.argv.slice(2);
if (!入口 || !输出) {
  console.error("用法：node tools/emit-code.mjs 入口.hmyr 输出.hmyrb");
  process.exit(2);
}
const unit = loadUnit(path.resolve(入口));
if (!unit.ok) {
  for (const e of unit.diagnostics.errors.slice(0, 8)) console.error(e.code + " " + e.message);
  process.exit(1);
}
// 返回类型的静态核对。放在编出字节之前 —— 一条「声明说 String 而交回数」的错，
// 该在这一步被说出来，而不是等程序跑到一半才显形。
//
// 只查得动「能确定形状」的表达式（字面量、元组字面量、调用、算术与比较的结果），
// 变量与下标一律放过 —— 静态检查的价值在于「说了就一定对」，猜出来的错比不查更坏。
{
  const 声明们 = [];
  for (const 文件 of unit.order) for (const d of unit.modules.get(文件).decls || []) 声明们.push(d);
  const 问题们 = 核对返回类型(声明们);
  if (问题们.length > 0) {
    for (const p of 问题们.slice(0, 8)) console.error((p.行 ? "第 " + p.行 + " 行：" : "") + p.话);
    if (问题们.length > 8) console.error("……还有 " + (问题们.length - 8) + " 处");
    process.exit(1);
  }
}
const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));
// 入口文件的 main 覆盖别人那一份。
//
// 为什么需要这一句：合并程序的规矩是「重名先到者赢」，而 import 的顺序是依赖在前 ——
// 于是 self/run.hmyr 编译出来，main 会是 self/lex.hmyr 自己那个自测。
// 症状是「跑起来没输出、退出码 19」—— 19 是 lex 的自测算出的词数，与入口毫无关系。
// 那一类错最难猜，所以规则写在这里：谁是入口，谁的 main 说了算。
const 入口名 = unit.order[unit.order.length - 1];
const 入口函 = 编译模块(unit.modules.get(入口名)).函数们.get("main");
if (!入口函) {
  console.error("入口文件里没有 main：" + 入口名);
  process.exit(1);
}
程序.函数们.set("main", 入口函);
const 字节 = 写程序(程序);
fs.writeFileSync(path.resolve(输出), 字节);
const 指令数 = [...程序.函数们.values()].reduce((n, f) => n + f.码.length, 0);
console.log(程序.函数们.size + " 个函数，" + 指令数 + " 条指令，" + 字节.length + " 字节 → " + 输出);
