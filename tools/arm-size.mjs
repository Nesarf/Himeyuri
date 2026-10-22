// ARM 那一侧的尺寸报告：这台机器占多少 Flash、多少 RAM。
//
// 为什么要量：上板子是一道很硬的账 —— 一颗 Cortex-M4 常常是 512 KB Flash、128 KB RAM，
// 而这一份代码带着四张 Unicode 表、一个字节码解释器、以及一个不回收的分配器。
// 「编得过」不等于「装得下」，这一份把那个数拿出来。
//
// 量法：用 armclang 把 vm/hmyr.c 与 port/arm-port.c 各自编成对象，
// 再用 fromelf 读每个段的字节数。code + ro 是 Flash 常住，rw + zi 是 RAM 常住。
//
// 用法：node tools/arm-size.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const 候选 = [
  process.env.ARMCLANG,
  "D:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe",
  "C:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe",
  "armclang",
].filter(Boolean);
const 编译器 = 候选.find((p) => {
  try { return spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
});
if (!编译器) {
  console.log("这台机器上没有 armclang —— 量不了");
  process.exit(0);
}
const 目录 = path.dirname(编译器);
const fromelf = path.join(目录, process.platform === "win32" ? "fromelf.exe" : "fromelf");

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-arm-size-"));

const 编 = (源, 出) => {
  const r = spawnSync(编译器, [
    "--target=arm-arm-none-eabi", "-mcpu=cortex-m4", "-O2", "-Wall",
    "-c", 源, "-o", 出,
  ], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(源 + " 没编过：\n" + String(r.stderr).slice(0, 600));
    process.exit(1);
  }
  return r;
};

const 量 = (对象) => {
  const r = spawnSync(fromelf, ["--text", "-z", 对象], { encoding: "utf8" });
  const 文 = String(r.stdout || "") + String(r.stderr || "");
  // 表格一行形如（五列数字，最后一列是名字）：
  //   Code (inc. data)   RO Data    RW Data    ZI Data      Debug   Object Name
  //   39140        1036     122426         12       1146        784   ...\hmyr.o
  for (const 行 of 文.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(行);
    if (m && /\.o$/i.test(m[7])) {
      return { code: +m[1], ro: +m[3], rw: +m[4], zi: +m[5], debug: +m[6] };
    }
  }
  return null;
};

const 部 = [
  ["这台机器", path.join(ROOT, "vm/hmyr.c"), path.join(临, "hmyr.o")],
  ["移植骨架", path.join(ROOT, "port/arm-port.c"), path.join(临, "port.o")],
];

const 行们 = [];
let flash = 0, ram = 0;
for (const [名, 源, 出] of 部) {
  编(源, 出);
  const 数 = 量(出);
  if (!数) { console.error(名 + "：fromelf 没给出尺寸"); process.exit(1); }
  行们.push([名, 数]);
  flash += 数.code + 数.ro;
  ram += 数.rw + 数.zi;
}

for (const [名, 数] of 行们) {
  console.log(名 + "  code " + 数.code + "  ro " + 数.ro + "  rw " + 数.rw + "  zi " + 数.zi);
}
console.log("——");
console.log("Flash 常住（code + ro）：" + flash + " 字节（" + (flash / 1024).toFixed(1) + " KB）");
console.log("RAM 常住（rw + zi）：" + ram + " 字节（" + (ram / 1024).toFixed(1) + " KB）");
console.log("注：这是这份代码自己的量，不含 C 库、启动文件、以及运行时的堆与栈。");

/* ---- 再往前一步：真的链出一张映像 -------------------------------------
 *
 * 上面量的是对象文件。链成映像之后会多出 C 库（microlib）、启动例程、
 * 以及链接脚本给的那块堆 —— 那才是烧进 Flash 的东西。
 * 没有 armlink 就跳过这一段，只报对象尺寸。 */
const armlink = path.join(目录, process.platform === "win32" ? "armlink.exe" : "armlink");
const 有链接器 = (() => {
  try { return spawnSync(armlink, ["--help"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

if (!有链接器) {
  console.log("链接器不在，映像这一步跳过。");
} else {
  const 启动 = path.join(临, "startup.o");
  const 启动汇编 = spawnSync(编译器, [
    "--target=arm-arm-none-eabi", "-mcpu=cortex-m4",
    "-c", path.join(ROOT, "port/startup_cm4.s"), "-o", 启动,
  ], { encoding: "utf8" });
  if (启动汇编.status !== 0) {
    console.error("启动文件没汇编过：\n" + String(启动汇编.stderr).slice(0, 400));
    process.exit(1);
  }
  const 映像 = path.join(临, "hmyr.axf");
  const 链 = spawnSync(armlink, [
    "--cpu=Cortex-M4", "--library_type=microlib",
    "--scatter=" + path.join(ROOT, "port/link.sct"),
    启动, path.join(临, "hmyr.o"), path.join(临, "port.o"),
    "-o", 映像,
  ], { encoding: "utf8" });
  if (链.status !== 0) {
    console.error("链接没过：\n" + String(链.stderr).slice(0, 600));
    process.exit(1);
  }
  const 量映像 = spawnSync(fromelf, ["--text", "-z", 映像], { encoding: "utf8" });
  const 文 = String(量映像.stdout || "");
  let rom = -1, rw = -1, zi = -1;
  for (const 行 of 文.split(/\r?\n/)) {
    // 「Totals」那几行的列语义不同，跳过；要的是组件行：
    //   Code (inc. data)  RO Data  RW Data  ZI Data  Debug   <映像>
    if (/Totals/i.test(行)) continue;
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+.*\.axf\s*$/.exec(行);
    if (m) { rom = +m[1] + +m[3]; rw = +m[4]; zi = +m[5]; }
  }
  console.log("——");
  console.log("映像（含 microlib、启动例程、链接脚本给的堆）：");
  console.log("  ROM " + rom + " 字节（" + (rom / 1024).toFixed(1) + " KB）");
  console.log("  RAM 里要占 rw " + rw + " + zi " + zi + " 字节（" + ((rw + zi) / 1024).toFixed(1) + " KB）");
}

fs.rmSync(临, { recursive: true, force: true });
