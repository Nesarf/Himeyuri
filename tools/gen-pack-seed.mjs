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
import { 平台参数 } from "../src/cc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 种子 = path.join(ROOT, "bootstrap/pack.hmtn");
const 头路 = path.join(ROOT, "vm/pack_seed.h");
const 符号 = "hmyr_pack_seed";

const 头 = [
  "/* HMYR 的种子，编成字节数组。",
  " *",
  " * 由 tools/gen-pack-seed.mjs 从 bootstrap/pack.hmtn 生成，别手改 ——",
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
const 编 = spawnSync("gcc", ["-std=c11", "-O2", ...平台参数(), "-o", exe,
  path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" });
if (编.status !== 0) { console.error("exe 编不出来：\n" + String(编.stderr).slice(0, 400)); process.exit(1); }

const 主体 = path.join(临, "body.h");
const 参 = [path.join(ROOT, "self/embed.hmoca"), 种子, 主体, 符号];
const 环境 = { ...process.env, HMYR_STEPS: "4000000000" };
let 跑 = spawnSync(exe, 参, { encoding: "utf8", timeout: 300000, env: 环境 });
// 退路：用 JS 那台再试一次。
//
// 为什么需要它（2026-11-02）：上面那个 exe 用的是**当前** vm/pack_seed.h 里的种子。
// 当种子落后于 self/ 的源码时（比如源码里刚换了一批关键字），旧种子编不动新源码 ——
// 报的是「没有这个全局名」，而那是自举固定点最典型的样子：要新头先得新机器，
// 要新机器先得新头。JS 那台不依赖 C 的内置种子，所以它能把这个环拆开；
// 头写出来之后，C 那台就又能自举了。
let 用了退路 = "";
if (跑.status !== 0 || !fs.existsSync(主体)) {
  // 第二条：用 HMYR_C_VM 指定的那台。它常常是上一轮编好的、内嵌着较新种子的机器 ——
  // 而「自己编一个」在这一刻恰好拿的是工作区里那份旧头，所以它编出来的机器编不动新源码。
  // 这一条是 2026-11-02 拆那个自举环时补的：先用旧机器生出新头，新机器再自举。
  const 现成 = process.env.HMYR_C_VM || "";
  if (现成 && fs.existsSync(现成)) {
    const 三 = spawnSync(现成, 参, { encoding: "utf8", timeout: 600000, env: 环境 });
    if (三.status === 0 && fs.existsSync(主体)) { 跑 = 三; 用了退路 = "HMYR_C_VM"; }
  }
}
if (跑.status !== 0 || !fs.existsSync(主体)) {
  const 二 = spawnSync(process.execPath, [path.join(ROOT, "bin/hmyr.mjs"), ...参],
    { encoding: "utf8", timeout: 600000, env: 环境 });
  if (二.status === 0 && fs.existsSync(主体)) { 跑 = 二; 用了退路 = "bin/hmyr.mjs"; }
}
if (跑.status !== 0 || !fs.existsSync(主体)) {
  // 第四条：JS 直接编出同样的数组。这一条是救援路 —— 自举环卡住的时候才走。
  //
  // 什么情况会用到它（2026-11-02）：种子里的编译器是上一版的，而源码刚换过关键字。
  // 那时「自己编的 exe」拿的是工作区里的旧头，HMYR_C_VM 那台也可能编得动却跑不动，
  // 于是头生成不出来；而头生成不出来，机器就永远是旧的。JS 这一侧不参与自举，
  // 所以它能把这一个环剪断。头写出来之后，下一轮自然走第一条路。
  const 原始 = fs.readFileSync(种子);
  const 段批 = [];
  for (let i = 0; i < 原始.length; i += 12) {
    const 一行 = [];
    for (let k = i; k < Math.min(i + 12, 原始.length); k++) 一行.push("0x" + 原始[k].toString(16).padStart(2, "0"));
    段批.push("  " + 一行.join(", ") + ", ");
  }
  fs.writeFileSync(主体, "/* 由 tools/gen-pack-seed.mjs 直接编出：" + 原始.length + " 字节 */\n"
    + "static const unsigned char " + 符号 + "[] = {\n" + 段批.join("\n") + "\n};\n"
    + "static const size_t " + 符号 + "_len = " + 原始.length + ";\n", "utf8");
  跑 = { status: 0, stderr: "" };
  用了退路 = "JS 直接编数组（救援路）";
}
if (跑.status !== 0 || !fs.existsSync(主体)) {
  console.error("embed.hmyr 没跑成：\n" + String(跑.stderr).slice(0, 400));
  process.exit(1);
}
if (用了退路) console.log("  （这一轮走了退路：" + 用了退路 + "）");

const 文 = 头 + fs.readFileSync(主体, "utf8") + "#endif  /* HMYR_PACK_SEED_H */\n";
fs.writeFileSync(头路, 文, "utf8");
const 字节 = fs.statSync(种子).size;
console.log("写好了 " + 头路);
console.log("  种子 " + 字节 + " 字节 · 头文件 " + Buffer.byteLength(文, "utf8") + " 字节");
if (!文.includes(符号 + "_len = " + 字节 + ";")) console.error("  警告：长度那一行与种子字节数对不上");
fs.rmSync(临, { recursive: true, force: true });
