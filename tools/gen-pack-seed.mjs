// 重新生成 vm/pack_seed.h：种子换成字节数组，再加上那一层手工的头。
//
// 为什么要一个工具而不是一条命令：self/embed.hmyr 生成的是主体（一行注释 + 数组 +
// 长度），而 vm/pack_seed.h 前面还有一段说明与重复包含守卫 —— 那两样是手写的，
// 生成器不管。以前这件事是「手工拼一次」，于是种子一换，守卫就丢了，
// 而丢的样子是 self-contained 里那条「有重复包含的守卫」变红。
//
// 用法：node tools/gen-pack-seed.mjs
//
// 它要一个能跑的 hmyr：自己编一个（gcc），因为它自己不依赖「上一次生成的 .h」——
// 编出来的 exe 用内置种子跑 self/embed.hmyr，而那正是「种子换新之后重生成自己」。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 种子 = path.join(ROOT, "bootstrap/pack.hmyrb");
const 头路 = path.join(ROOT, "vm/pack_seed.h");
const 符号 = "hmyr_pack_seed";

const 头 = [
  "/* HMYR 的种子，编成字节数组。",
  " *",
  " * 由 tools/gen-pack-seed.mjs 从 bootstrap/pack.hmyrb 生成，别手改 ——",
  " * 改了它，生成器下一次就会把它改回去。",
  " *",
  " * 它让 hmyr 这个可执行文件自带编译器：一份 .hmyr 进来，先用这份种子编成字节码，",
  " * 再跑那一段字节码。于是「跑一个程序」不再需要 node，也不再需要先手动编一次。",
  " */",
  "#ifndef HMYR_PACK_SEED_H",
  "#define HMYR_PACK_SEED_H",
  "#include <stddef.h>",
  "",
].join("\n");

if (!fs.existsSync(种子)) { console.error("没有种子：" + 种子); process.exit(2); }

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-seedgen-"));
const exe = path.join(临, "hmyr.exe");
const 编 = spawnSync("gcc", ["-std=c11", "-O2", "-Wl,--stack,67108864", "-o", exe,
  path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
if (编.status !== 0) { console.error("exe 编不出来：\n" + String(编.stderr).slice(0, 400)); process.exit(1); }

const 主体 = path.join(临, "body.h");
const 跑 = spawnSync(exe, [path.join(ROOT, "self/embed.hmyr"), 种子, 主体, 符号], {
  encoding: "utf8", timeout: 300000,
  env: { ...process.env, HMYR_STEPS: "4000000000" },
});
if (跑.status !== 0 || !fs.existsSync(主体)) {
  console.error("embed.hmyr 没跑成：\n" + String(跑.stderr).slice(0, 400));
  process.exit(1);
}

const 文 = 头 + fs.readFileSync(主体, "utf8") + "#endif  /* HMYR_PACK_SEED_H */\n";
fs.writeFileSync(头路, 文, "utf8");
const 字节 = fs.statSync(种子).size;
console.log("写好了 " + 头路);
console.log("  种子 " + 字节 + " 字节 · 头文件 " + Buffer.byteLength(文, "utf8") + " 字节");
if (!文.includes(符号 + "_len = " + 字节 + ";")) console.error("  警告：长度那一行与种子字节数对不上");
fs.rmSync(临, { recursive: true, force: true });
