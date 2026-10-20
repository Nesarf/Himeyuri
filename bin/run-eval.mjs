// 求值器的命令行那一面：从 eval.mjs 搬出来的十几行。
//
//   node bin/run-eval.mjs <file.hmyr>
//
// 它一直不属于库：读一个文件、打印输出与诊断、按退出码退出。搬出来之后，
// src/eval.mjs 不再 import fs/path/url——于是「求值器不借世界」这句话可以不带条件地说。
//
// 宿主能力在这里也是显式给的：本机能力。一个不给能力的求值器起不来（它对世界一无所知），
// 而那正是这一层想要的——「借了什么」要写在调用者的那一行上。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/eval.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const 根 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 文件 = process.argv[2];
if (!文件) {
  console.log("usage: node bin/run-eval.mjs <file.hmyr>");
  process.exit(1);
}

const 结果 = run(fs.readFileSync(文件, "utf8"), { path: 文件, capabilities: 本机能力() });
for (const 行 of 结果.output) console.log(行);
for (const d of 结果.diagnostics.items) console.log("  " + d.severity + " " + d.code + "  " + d.message);
process.exit(结果.diagnostics.errors.length ? 1 : 0);
