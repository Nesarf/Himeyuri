// HMYR 的启动器：把 .hmyr 交给语言自己。
//
//   node bin/hmyr.mjs <file.hmyr>
//
// 它只剩下四件事，而每一件都是「宿主才知道」的：
//
//   一、取命令行参数（argv 是宿主的事）
//   二、从目标路径算出目录与文件名（路径分隔符是宿主的事）
//   三、把自举那一层读进来（读它需要宿主的词法与求值器）
//   四、把文字打出去（终端是宿主的事）
//
// 读目标文件、认 import、递归合并——这些以前都在这儿，现在搬进了 self/run.hmyr。
// 它们是「关于 HMYR 的知识」，宿主不该比语言更懂 HMYR。
//
// 能力边界照旧写在明处：内核只做四件事——读自己的源码、写终端、取参数、退出码。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnit, runUnit } from "../src/loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const target = process.argv[2];
if (!target) {
  process.stderr.write("用法：node bin/hmyr.mjs <file.hmyr>\n");
  process.exit(2);
}

// 借宿主的那一件事：把自举那一层读进来。之后目标程序不再经过宿主的语言层。
const rt = runUnit(loadUnit(path.join(ROOT, "self/run.hmyr")));
rt.write = (s) => process.stdout.write(s);

// 目录与文件名：路径的分隔符是宿主的事，而「哪个文件引了哪个」不是。
const 绝对 = path.resolve(target);
try {
  const 结果 = rt.callFunction(rt.functions.get("跑文件入口"), [path.dirname(绝对), path.basename(绝对)], null);
  // 语言那边交回 {ok, 文字}：文字是答案或是一句说明，而 ok 说「这算不算失败」。
  // 「什么算致命」这件事在语言里决定，启动器只照着退出码。
  const 文字 = 结果 && 结果.文字 !== undefined ? String(结果.文字) : String(结果);
  if (结果 && 结果.ok === false) {
    process.stderr.write(文字 + "\n");
    process.exit(1);
  }
  process.stdout.write(文字 + "\n");
} catch (err) {
  // 读不到文件时，语言那边会以 R0211 停下。把它的编号与原因原样交出去，
  // 而不是在这儿另造一套说法——两个说法迟早会不一致。
  const 码 = err && err.code ? err.code : "HMYR-R0211";
  const 因 = err && err.message ? err.message : String(err);
  process.stderr.write(码 + " " + 因 + "\n");
  process.exit(1);
}
