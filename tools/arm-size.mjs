// ARM 那一侧的尺寸报告：这台机器占多少 Flash、多少 RAM。
//
// 为什么要量：上板子是一道很硬的账 —— 一颗 Cortex-M4 常常是 512 KB Flash、128 KB RAM，
// 而这一份代码带着四张 Unicode 表、一个字节码解释器、以及一个不回收的分配器。
// 「编得过」不等于「装得下」，这一份把那个数拿出来。
//
// 两家工具链都认，先找 GNU（免费，谁都能装），再找 armclang（Keil 那份）：
//
//   GNU      arm-none-eabi-gcc 编与链，arm-none-eabi-size -A 量段
//   Arm      armclang 编，armlink 链，fromelf 量段
//
// 两家的链接脚本不同（link.ld 与 link.sct）、启动文件也不同（startup_cm4_gnu.s
// 自己拷 .data、清 .bss，而 startup_cm4.s 把这件事交给 Arm C 库的 __main）。
// 两套都在，是因为换工具链不该等于换布局：脚本里的地址与大小是同一组数字。
//
// 用法：node tools/arm-size.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const 找 = (候选们) => 候选们.filter(Boolean).find((p) => {
  try { return spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
});

// GNU 那一支。xPack 的包解开之后就在这一层，装到哪里都可以 —— ARM_GCC 覆盖它。
const gcc = 找([
  process.env.ARM_GCC,
  "E:/DaShaoHuo/downloads/arm-gnu-toolchain/xpack-arm-none-eabi-gcc-15.2.1-1.1/bin/arm-none-eabi-gcc.exe",
  "arm-none-eabi-gcc",
]);
const clang = 找([
  process.env.ARMCLANG,
  "D:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe",
  "C:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe",
  "armclang",
]);

if (!gcc && !clang) {
  console.log("这台机器上没有 arm-none-eabi-gcc，也没有 armclang —— 量不了");
  process.exit(0);
}

const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-arm-size-"));
const 部 = [
  ["这台机器", path.join(ROOT, "vm/hmyr.c"), path.join(临, "hmyr.o")],
  ["移植骨架", path.join(ROOT, "port/arm-port.c"), path.join(临, "port.o")],
];

// `size -A` 的输出是一张段表：段名、字节数、地址。总表那一行叫 Total，跳过。
const 读段表 = (文) => {
  const 表 = [];
  for (const 行 of 文.split(/\r?\n/)) {
    const m = /^\s*(\.[\w.]+)\s+(\d+)\s+\d+\s*$/.exec(行);
    if (m) 表.push([m[1], Number(m[2])]);
  }
  return 表;
};
const 分 = (表) => {
  // .data 的初值在 Flash，运行在 RAM —— 两处都要算，所以它单独处理。
  let flash = 0, ram = 0;
  for (const [名, 长] of 表) {
    if (名.startsWith(".data")) { flash += 长; ram += 长; continue; }
    if (/^\.(isr_vector|text|rodata|init|fini)/.test(名) || 名.startsWith(".ARM")) { flash += 长; continue; }
    if (/^\.(bss|heap|stack|noinit)/.test(名)) { ram += 长; continue; }
  }
  return { flash, ram };
};

if (gcc) {
  console.log("工具链：GNU（" + gcc + "）");
  const 前缀 = gcc.replace(/gcc(\.exe)?$/i, "");
  const 尺寸 = 前缀 + (process.platform === "win32" ? "size.exe" : "size");
  const 编 = (源, 出) => {
    const r = spawnSync(gcc, ["-mcpu=cortex-m4", "-mthumb", "-O2", "-Wall", "-c", 源, "-o", 出], { encoding: "utf8" });
    if (r.status !== 0) { console.error(源 + " 没编过：\n" + String(r.stderr).slice(0, 700)); process.exit(1); }
    return r;
  };
  const 量 = (文件) => 读段表(String(spawnSync(尺寸, ["-A", 文件], { encoding: "utf8" }).stdout || ""));

  let flash = 0, ram = 0;
  for (const [名, 源, 出] of 部) {
    编(源, 出);
    const 表 = 量(出);
    const 数 = 分(表);
    console.log(名 + "  flash " + 数.flash + "  ram " + 数.ram);
    flash += 数.flash;
    ram += 数.ram;
  }
  console.log("——");
  console.log("Flash 常住（code + ro）：" + flash + " 字节（" + (flash / 1024).toFixed(1) + " KB）");
  console.log("RAM 常住（rw + zi）：" + ram + " 字节（" + (ram / 1024).toFixed(1) + " KB）");
  console.log("注：这是这份代码自己的量，不含 C 库、启动文件、以及运行时的堆与栈。");

  // ---- 真链出一张映像 ----
  // 启动文件用 GNU 那一份：它自己拷 .data、清 .bss，然后调 main。
  // -nostartfiles 是因为启动由我们自己的 Reset_Handler 负责，不要 crt0 抢在前面；
  // nosys.specs 给 newlib 那几个系统调用的桩，否则链接会缺 _write 之类。
  const 启动 = path.join(临, "startup.o");
  const 启动汇编 = spawnSync(gcc, ["-mcpu=cortex-m4", "-mthumb", "-c",
    path.join(ROOT, "port/startup_cm4_gnu.s"), "-o", 启动], { encoding: "utf8" });
  if (启动汇编.status !== 0) {
    console.error("启动文件没汇编过：\n" + String(启动汇编.stderr).slice(0, 500));
    process.exit(1);
  }
  const 映像 = path.join(临, "hmyr.elf");
  const 链 = spawnSync(gcc, [
    "-mcpu=cortex-m4", "-mthumb", "-nostartfiles", "--specs=nosys.specs",
    "-T", path.join(ROOT, "port/link.ld"),
    "-Wl,--gc-sections", "-Wl,--allow-multiple-definition",
    "-o", 映像, 启动, path.join(临, "hmyr.o"), path.join(临, "port.o"),
    "-lm",
  ], { encoding: "utf8" });
  if (链.status !== 0) {
    // 失败时那段 stderr 里九成是 newlib 桩的 warning 与长路径，真正的错夹在中间。
    // 全量落一份到临时目录，回显只留要紧的那几行。
    const 全 = String(链.stderr || "");
    const 日志 = path.join(os.tmpdir(), "hmyr-arm-link.log");
    fs.writeFileSync(日志, 全, "utf8");
    const 要紧 = 全.split(/\r?\n/).filter((l) => /error|undefined reference|multiple definition/i.test(l));
    console.error("链接没过（完整日志在 " + 日志 + "）：\n" + (要紧.slice(0, 20).join("\n") || "（没有 error 行 —— 可能只是坏在退出码上）"));
    process.exit(1);
  }
  const 印 = 分(量(映像));
  console.log("——");
  console.log("映像（含启动例程、C 库选择、链接脚本给的堆与栈）：");
  console.log("  ROM " + 印.flash + " 字节（" + (印.flash / 1024).toFixed(1) + " KB）");
  console.log("  RAM " + 印.ram + " 字节（" + (印.ram / 1024).toFixed(1) + " KB）");
} else {
  // ---- Arm 那一支：保持原样 ----
  console.log("工具链：Arm（" + clang + "）");
  const 目录 = path.dirname(clang);
  const fromelf = path.join(目录, process.platform === "win32" ? "fromelf.exe" : "fromelf");
  const armlink = path.join(目录, process.platform === "win32" ? "armlink.exe" : "armlink");

  const 编 = (源, 出) => {
    const r = spawnSync(clang, ["--target=arm-arm-none-eabi", "-mcpu=cortex-m4", "-O2", "-Wall", "-c", 源, "-o", 出], { encoding: "utf8" });
    if (r.status !== 0) { console.error(源 + " 没编过：\n" + String(r.stderr).slice(0, 600)); process.exit(1); }
    return r;
  };
  const 量 = (对象) => {
    const 文 = String(spawnSync(fromelf, ["--text", "-z", 对象], { encoding: "utf8" }).stdout || "");
    for (const 行 of 文.split(/\r?\n/)) {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(行);
      if (m && /\.o$/i.test(m[7])) return { code: +m[1], ro: +m[3], rw: +m[4], zi: +m[5] };
    }
    return null;
  };

  let flash = 0, ram = 0;
  for (const [名, 源, 出] of 部) {
    编(源, 出);
    const 数 = 量(出);
    if (!数) { console.error(名 + "：fromelf 没给出尺寸"); process.exit(1); }
    console.log(名 + "  code " + 数.code + "  ro " + 数.ro + "  rw " + 数.rw + "  zi " + 数.zi);
    flash += 数.code + 数.ro;
    ram += 数.rw + 数.zi;
  }
  console.log("——");
  console.log("Flash 常住（code + ro）：" + flash + " 字节（" + (flash / 1024).toFixed(1) + " KB）");
  console.log("RAM 常住（rw + zi）：" + ram + " 字节（" + (ram / 1024).toFixed(1) + " KB）");
  console.log("注：这是这份代码自己的量，不含 C 库、启动文件、以及运行时的堆与栈。");

  const 有链接器 = (() => {
    try { return spawnSync(armlink, ["--help"], { encoding: "utf8" }).status === 0; } catch { return false; }
  })();
  if (!有链接器) {
    console.log("链接器不在，映像这一步跳过。");
  } else {
    const 启动 = path.join(临, "startup.o");
    const 启动汇编 = spawnSync(clang, ["--target=arm-arm-none-eabi", "-mcpu=cortex-m4",
      "-c", path.join(ROOT, "port/startup_cm4.s"), "-o", 启动], { encoding: "utf8" });
    if (启动汇编.status !== 0) {
      console.error("启动文件没汇编过：\n" + String(启动汇编.stderr).slice(0, 400));
      process.exit(1);
    }
    const 映像 = path.join(临, "hmyr.axf");
    const 链 = spawnSync(armlink, ["--cpu=Cortex-M4", "--library_type=microlib",
      "--scatter=" + path.join(ROOT, "port/link.sct"),
      启动, path.join(临, "hmyr.o"), path.join(临, "port.o"), "-o", 映像], { encoding: "utf8" });
    if (链.status !== 0) {
      console.error("链接没过：\n" + String(链.stderr).slice(0, 600));
      process.exit(1);
    }
    const 文 = String(spawnSync(fromelf, ["--text", "-z", 映像], { encoding: "utf8" }).stdout || "");
    let rom = -1, rw = -1, zi = -1;
    for (const 行 of 文.split(/\r?\n/)) {
      if (/Totals/i.test(行)) continue;
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+.*\.axf\s*$/.exec(行);
      if (m) { rom = +m[1] + +m[3]; rw = +m[4]; zi = +m[5]; }
    }
    console.log("——");
    console.log("映像（含 microlib、启动例程、链接脚本给的堆）：");
    console.log("  ROM " + rom + " 字节（" + (rom / 1024).toFixed(1) + " KB）");
    console.log("  RAM 里要占 rw " + rw + " + zi " + zi + " 字节（" + ((rw + zi) / 1024).toFixed(1) + " KB）");
  }
}

fs.rmSync(临, { recursive: true, force: true });
