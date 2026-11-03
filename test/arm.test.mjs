// C 那台机器能不能离开桌面：用 ARM 的编译器把它编到 Cortex-M4。
//
// 这一套问的是一件具体的事：vm/hmyr.c 里写的那些东西，除了 Windows 与 POSIX，
// 还能不能编到一块没有操作系统、没有文件系统、没有进程的板子上。
// 编得过不等于跑得起来（下面的「还差什么」写在 design/C-VM.txt），
// 但编不过是硬答案：那说明这台机器的代码里还有桌面假设。
//
// 找编译器：环境变量 ARMCLANG，或者 Keil 常见的两处安装位置，或者 PATH。
// 找不到就明说跳过，不算失败 —— 那是这台机器上有没有那套工具的事。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 两家工具链都认：GNU 免费，谁都能装；Arm 那一支是 Keil 自带的。
// 先找 GNU —— 它的链接脚本与启动文件是另外两份（port/link.ld 与 port/startup_cm4_gnu.s），
// 与 link.sct / startup_cm4.s 一一对应。换工具链换的是这两件，不是布局。
const 找 = (们) => 们.filter(Boolean).find((p) => {
  try { return spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
});
const gcc = 找([
  process.env.ARM_GCC,
  "E:/DaShaoHuo/downloads/arm-gnu-toolchain/xpack-arm-none-eabi-gcc-15.2.1-1.1/bin/arm-none-eabi-gcc.exe",
  "arm-none-eabi-gcc",
]);
const 编译器 = gcc || 找([
  process.env.ARMCLANG,
  "D:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe",
  "C:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe",
  "armclang",
]);
const 是GNU = !!gcc;

if (!编译器) {
  console.log("  跳过  这台机器上既没有 arm-none-eabi-gcc，也没有 armclang —— ARM 那一套不运行");
  console.log("");
  console.log("0 passed, 0 failed");
  process.exit(0);
}

console.log("一、C 那台机器编到 Cortex-M4 裸机");
{
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-arm-"));
  const 出 = path.join(临, "hmyr.o");
  const r = spawnSync(编译器, [
    ...(是GNU ? ["-mcpu=cortex-m4", "-mthumb", "-O2", "-Wall"]
              : ["--target=arm-arm-none-eabi", "-mcpu=cortex-m4", "-O2", "-Wall"]),
    "-c", path.join(ROOT, "vm/hmyr.c"), "-o", 出,
  ], { encoding: "utf8", timeout: 300000 });
  ok("编译器编得过（" + (是GNU ? "GNU" : "Arm") + "）", r.status === 0, String(r.stderr).slice(0, 300));
  ok("而且没有警告", String(r.stderr).trim() === "", String(r.stderr).slice(0, 300));
  if (fs.existsSync(出)) {
    const 大小 = fs.statSync(出).size;
    ok("产出了对象文件（一百千字节上下）", 大小 > 100 * 1024, String(大小));
  } else {
    ok("产出了对象文件（一百千字节上下）", false, "没有文件");
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("一之二、同一份代码编到 Cortex-M7（桌上那块 H723ZG）");
{
  // H723ZG 是 Cortex-M7，带双精度 FPU —— 与上面 M4 那条路的差别就是这三个开关：
  // -mcpu=cortex-m7、-mfpu=fpv5-d16、-mfloat-abi=hard。
  // 这一节 2026-11-03 加的，因为桌上接了一块 H723ZG 的核心板，而 arm 那一套原来只认 M4。
  // 它验的是「同一份 C 机器」这句话对 M7 也成立 —— 不需要板子，只要工具链。
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-arm-m7-"));
  const 出 = path.join(临, "hmyr-m7.o");
  const 选 = 是GNU
    ? ["-mcpu=cortex-m7", "-mthumb", "-mfpu=fpv5-d16", "-mfloat-abi=hard", "-O2", "-Wall"]
    : ["--target=arm-arm-none-eabi", "-mcpu=cortex-m7", "-mfpu=fpv5-d16", "-mfloat-abi=hard", "-O2", "-Wall"];
  const r = spawnSync(编译器, [...选, "-c", path.join(ROOT, "vm/hmyr.c"), "-o", 出],
    { encoding: "utf8", timeout: 300000 });
  ok("编译器编得过 M7", r.status === 0, String(r.stderr).slice(0, 300));
  ok("而且没有警告", String(r.stderr).trim() === "", String(r.stderr).slice(0, 300));
  if (fs.existsSync(出)) {
    const 大小 = fs.statSync(出).size;
    ok("产出了对象文件（一百千字节上下）", 大小 > 100 * 1024, String(大小));
  } else {
    ok("产出了对象文件（一百千字节上下）", false, "没有文件");
  }
  fs.rmSync(临, { recursive: true, force: true });
}

console.log("一之三、链到 H723：编得过之后的下一关是链得出、布局对");
{
  // 一 与 一之二 都只用 -c，验的是「编得过」。而板子上要的是链之后的映像：
  // 向量表在 Flash 起点、入口紧跟着它、栈顶落在 RAM 里、各段装得下。四件都能用
  // nm 与 size 读到，所以这一节不需要板子，也不需要 ST-Link。
  //
  // 走 port/Makefile 而不是把六条 gcc 命令行抄一遍：那一份已经是「换芯片改旋钮」的
  // 形状，抄过来就多一处要同步。make 不在就跳过 —— 与 armclang 那一支同一个态度。
  const make = 找(["make", "E:/msys64/usr/bin/make.exe", "D:/msys64/usr/bin/make.exe"]);
  if (!是GNU) {
    console.log("  跳过  这一节要 GNU 工具链；Arm 那一支的链接脚本是 link.sct，不是 link-h723.ld");
  } else if (!make) {
    console.log("  跳过  这台机器上没有 make（MSYS2 那一份也不在常见位置）");
  } else {
    const 端口 = path.join(ROOT, "port");
    const 映 = path.join(端口, "build", "hmyr-board.elf");
    fs.rmSync(映, { force: true });
    const 前缀 = gcc.replace(/gcc(\.exe)?$/i, "");
    const r = spawnSync(make, ["h723", "CROSS=" + 前缀], { cwd: 端口, encoding: "utf8", timeout: 900000 });
    ok("make h723 链得出来", r.status === 0 && fs.existsSync(映),
      String(r.status) + " " + String(r.stderr || "").slice(-300));
    if (fs.existsSync(映)) {
      const 跑 = (具, 参) => spawnSync(前缀 + 具, 参, { encoding: "utf8" }).stdout || "";
      const 符 = 跑("nm" + (是GNU ? ".exe" : ""), ["-n", 映]);
      const 取 = (名) => {
        const m = new RegExp("^([0-9a-fA-F]+) \\w+ " + 名 + "$", "m").exec(符);
        return m ? parseInt(m[1], 16) : null;
      };
      const 十六 = (n) => (n === null ? "无" : "0x" + n.toString(16));
      const 向量 = 取("__Vectors"), 入口 = 取("Reset_Handler"), 栈顶 = 取("_estack");
      ok("向量表在 Flash 起点", 向量 === 0x08000000, 十六(向量));
      ok("入口紧跟在向量表后面", 入口 !== null && 入口 >= 0x08000040 && 入口 < 0x08000200, 十六(入口));
      // 栈顶必须落在 AXI SRAM（0x24000000 起 512 KB）里：掉到 0x20000000 是摸到了
      // DTCM，越过 0x24080000 是越界 —— 两种都只会在第一次中断时 HardFault，
      // 而那时串口一个字都没有，看上去像「程序没跑」。
      ok("栈顶落在 AXI SRAM 里", 栈顶 !== null && 栈顶 > 0x24000000 && 栈顶 <= 0x24080000, 十六(栈顶));
      const 量 = 跑("size" + (是GNU ? ".exe" : ""), [映]);
      const 行 = 量.split("\n").find((l) => /^\s*\d+/.test(l)) || "";
      const 数 = 行.trim().split(/\s+/).map(Number);
      ok("代码装得进 1 MB 的 Flash", 数[0] > 0 && 数[0] < 1024 * 1024, String(数[0]));
      ok("静态 RAM 装得进 512 KB", 数[1] + 数[2] > 0 && 数[1] + 数[2] < 512 * 1024, (数[1] + 数[2]) + " 字节");
    }
  }
}

console.log("二、桌面专属的那几处都在条件编译里");
{
  const 源 = fs.readFileSync(path.join(ROOT, "vm/hmyr.c"), "utf8");
  // 这三处是桌面假设：Windows 的宽字符路径、文本模式的开关、以及 pid。
  // 它们都该在 _WIN32 或非 ARM 的分支里，不能裸露在裸机那一条上。
  const 裸机段 = 源.split(/\n/).filter((l) => !/^\s*#/.test(l));
  ok("没有裸奔的 windows.h", !裸机段.some((l) => /#include\s*<windows\.h>/.test(l)));
  ok("unistd.h 在 ARM 上不进来", 源.includes("!defined(__arm__)"));
  ok("临时路径对 ARM 有另外一条分支", 源.includes("defined(__ARM_ARCH)"));
}

console.log("三、读与写是显式的平台口，板子装得进");
{
  const 源 = fs.readFileSync(path.join(ROOT, "vm/hmyr.c"), "utf8");
  // 「读一个文件」「写一段字节」是这台机器上唯一两件每块板子都不一样的事。
  // 它们成了两个函数指针，桌面那份是默认值 —— 于是板子只要装一次。
  ok("有一个装平台口的入口", /^void hmyr_装平台\(/m.test(源));
  ok("读走的是平台口", 源.includes("g_平台.读"));
  ok("写走的是平台口", 源.includes("g_平台.写"));
  ok("桌面那两份实现还在（不装时行为不变）", 源.includes("桌面读文件"));
}

console.log("四、尺寸：Flash 与 RAM 各要多少");
{
  // 「编得过」不等于「装得下」。这一节把那个数拿出来，并钉住数量级 ——
  // 数字变了它就会红，而红的时候先看 design/C-VM.txt 里记的那一版的量法。
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/arm-size.mjs")], { encoding: "utf8", timeout: 300000 });
  ok("arm-size 跑得通", r.status === 0, String(r.stderr).slice(0, 200));
  const 文 = String(r.stdout || "");
  const f = /Flash 常住[^：]*：(\d+) 字节/.exec(文);
  const m = /RAM 常住[^：]*：(\d+) 字节/.exec(文);
  const Flash = f ? Number(f[1]) : -1;
  const Ram = m ? Number(m[1]) : -1;
  // Flash 与 RAM 的合并数之外，还要看分成哪两块（2026-11-02 改）。
  //
  // 为什么：arm-size.mjs 报的 RAM 是「这台机器」与「移植骨架」两块相加，而它们
  // 量的不是同一件事 —— 前者是 vm/hmyr.c 的 .data 与 .bss，后者是 port/ 那套
  // UART 缓冲与平台口。合成一个数比 8192，红的时候分不清是谁超了。
  // 现在分三条：本体、骨架、合计，各按各自该有的量级看。
  const 机 = /这台机器\s+flash (\d+)\s+ram (\d+)/.exec(文);
  const 架 = /移植骨架\s+flash (\d+)\s+ram (\d+)/.exec(文);
  const 机Ram = 机 ? Number(机[2]) : -1;
  const 架Ram = 架 ? Number(架[2]) : -1;
  ok("Flash 约一百六十千字节（含四张 Unicode 表）", Flash > 100 * 1024 && Flash < 220 * 1024, String(Flash));
  ok("机器本体的 RAM 在八千字节以内", 机Ram > 0 && 机Ram < 8192, String(机Ram));
  ok("移植骨架的 RAM 在八千字节以内（UART 缓冲与平台口）", 架Ram > 0 && 架Ram < 8192, String(架Ram));
  ok("两块合计在十六千字节以内（含示例那四 KB 出口缓冲）", Ram > 0 && Ram < 16384, String(Ram));
}

console.log("五、真的链出一张映像（启动文件 + 链接脚本）");
{
  // 「编得过」与「链得过」之间隔着启动例程、链接脚本、以及 C 库的入口。
  // 这一节链的是 port/startup_cm4.s + port/link.sct + 这台机器 + 移植骨架。
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/arm-size.mjs")], { encoding: "utf8", timeout: 300000 });
  const 文 = String(r.stdout || "") + String(r.stderr || "");
  ok("链接那一步跑得通（工具里没有报错）", r.status === 0 && !/链接没过/.test(文), String(r.stderr).slice(0, 200));
  const rom = /ROM (\d+) 字节/.exec(文);
  // 两家工具链的最后一节措辞不同：Arm 那份写「rw N + zi M」，GNU 那份写「RAM N 字节」。
  // 只认一种的话，换工具链就会在这一条上读成 -1 —— 那不是尺寸不对，是读法没跟上。
  const ramArm = /rw (\d+) \+ zi (\d+)/.exec(文);
  const ramGNU = /RAM (\d+) 字节/.exec(文);
  const 甲 = rom ? Number(rom[1]) : -1;
  const 乙 = ramArm ? Number(ramArm[1]) + Number(ramArm[2]) : (ramGNU ? Number(ramGNU[1]) : -1);
  // 上限随种子走：种子（pack_seed.h）整个进 ROM，它长一点这张映像就长一点。
  // 2026-10-27 种子从 51475 涨到 51935（方法调用那条指令的编译与打包），桌面这一张
  // 从 220 KiB 的边界上越过 419 字节 —— 那说明余量不够，不是这段代码变胖。
  ok("映像的 ROM 在二百二十千字节上下", 甲 > 140 * 1024 && 甲 < 240 * 1024, String(甲));
  ok("映像的 RAM 在四十五千字节上下（含堆与出口缓冲）", 乙 > 30 * 1024 && 乙 < 64 * 1024, String(乙));
}

console.log("六、板子上那一份的入口");
{
  // 第五节链的是「桌面 main + 移植骨架」：字节码从文件名读，输出打到 stdout。
  // 这张映像烧进板子只会打一行 usage 然后停住 —— 它的 main 是桌面那个。
  //
  // 这一节问的是另一件事：有没有一张映像的入口就是 port/board-main.c，
  // 字节码编在里面，上电就跑。判据不是我信不信，是两样能查的东西 ——
  // 桌面 main 会打的那行 usage 在不在映像里，字节码符号在不在映像里。
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/arm-size.mjs")], { encoding: "utf8", timeout: 300000 });
  const 文 = String(r.stdout || "") + String(r.stderr || "");
  ok("arm-size 报出了板子那一张", /板子 ROM \d+ 字节/.test(文), String(r.stderr).slice(0, 200));
  const rom = /板子 ROM (\d+) 字节/.exec(文);
  const ram = /板子 RAM (\d+) 字节/.exec(文);
  const 甲 = rom ? Number(rom[1]) : -1;
  const 乙 = ram ? Number(ram[1]) : -1;
  // 这一张比第五节那张小一点：桌面 main 与它那一串启动器没了，
  // 多出来的是 board-main.o 与二百字节的字节码。
  ok("板子那一张的 ROM 在二百千字节上下", 甲 > 180 * 1024 && 甲 < 240 * 1024, String(甲));
  ok("板子那一张的 RAM 在五十千字节上下（含堆与出口缓冲）", 乙 > 40 * 1024 && 乙 < 64 * 1024, String(乙));
  ok("入口是板子那一份（桌面 main 的 usage 不在映像里）",
    /板子入口 板子那一份/.test(文), String(/板子入口[^\n]*/.exec(文)?.[0] || "（没有这一行）"));
  // 这一条盯的是链接脚本：board-main.c 对字节码是弱引用，而弱引用拦不住
  // --gc-sections。少了 link.ld 里那句 KEEP(*(.program))，映像照样链得过、
  // 照样烧得进，跑起来却报「读不到文件」。
  ok("字节码真的在映像里（KEEP 生效了）",
    /板子字节码 在映像里/.test(文), String(/板子字节码[^\n]*/.exec(文)?.[0] || "（没有这一行）"));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
