// 用字节码虚拟机跑一份 .hmyrb。
//
// 与 bin/hmyr.mjs 的区别：那一个跑的是自举解释器（读 self/run.hmyr 再解释目标程序），
// 这一个直接执行字节码 —— 于是它是「同一份字节码，两台机器」里的 JS 那一台，
// 与 vm/hmyr.c 对着看。
//
// 用法：node tools/run-bytecode.mjs 程序.hmyrb [参数...]
//
// 有 命令行入口 就跑它（自举层的真入口），否则跑 main。
// HMYR_TRACE=1 时打印最后四十条指令，与 C 那台的轨迹对齐着看。
// HMYR_STEPS 可以放大步数上限（跑解释器时才需要）。
import fs from "node:fs";
import path from "node:path";
import { 读程序 } from "../src/code-file.mjs";
import { 虚拟机, 迹输出 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const [码路, ...参] = process.argv.slice(2);
if (!码路) {
  console.error("用法：node tools/run-bytecode.mjs 程序.hmyrb [参数...]");
  process.exit(2);
}
const 程序 = 读程序(fs.readFileSync(path.resolve(码路)), null);
const 步限 = process.env.HMYR_STEPS ? Number(process.env.HMYR_STEPS) : 5_000_000;

const vm = new 虚拟机(程序, {
  capabilities: 本机能力(),
  argv: [码路, ...参],
  stepLimit: 步限,
  // 深限也要放宽：跑解释器时一个目标程序的每条语句都要多套两层递归。
  maxDepth: 4000,
});
vm.write = (s) => process.stdout.write(s);
vm.writeErr = (s) => process.stderr.write(s);

const 入口 = 程序.函数们.has("命令行入口") ? "命令行入口" : "main";
const r = vm.调用(入口, [], null);
迹输出();
if (!r.ok) {
  console.error(r.码 + " " + r.话);
  process.exit(1);
}
// 返回值当退出码，与 C 那台一致（不打印它）。
process.exit(typeof r.值 === "number" ? Math.trunc(r.值) : 0);
