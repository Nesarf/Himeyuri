// 把一份 .hmyr 编成 .hmyrb。
//
// 用法：node tools/emit-code.mjs 入口.hmyr 输出.hmyrb
//
// 这一件存在的理由是「那台不是 JS 的机器」：它要执行的东西得先落在文件里。
// 与它配套的是 src/code-file.mjs（格式）与将来那份 C 读法。
import fs from "node:fs";
import path from "node:path";
import { loadUnit } from "../src/loader.mjs";
import { 编译模块, 合并程序 } from "../src/bytecode.mjs";
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
const 程序 = 合并程序(unit.order.map((文件) => 编译模块(unit.modules.get(文件))));
const 字节 = 写程序(程序);
fs.writeFileSync(path.resolve(输出), 字节);
const 指令数 = [...程序.函数们.values()].reduce((n, f) => n + f.码.length, 0);
console.log(程序.函数们.size + " 个函数，" + 指令数 + " 条指令，" + 字节.length + " 字节 → " + 输出);
