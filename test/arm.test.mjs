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

const 候选 = [
  process.env.ARMCLANG,
  "D:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe",
  "C:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe",
  "armclang",
].filter(Boolean);
const 编译器 = 候选.find((p) => {
  try {
    return spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0;
  } catch { return false; }
});

if (!编译器) {
  console.log("  跳过  这台机器上没有 armclang —— ARM 那一套不运行");
  console.log("");
  console.log("0 passed, 0 failed");
  process.exit(0);
}

console.log("一、C 那台机器编到 Cortex-M4 裸机");
{
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-arm-"));
  const 出 = path.join(临, "hmyr.o");
  const r = spawnSync(编译器, [
    "--target=arm-arm-none-eabi", "-mcpu=cortex-m4", "-O2", "-Wall",
    "-c", path.join(ROOT, "vm/hmyr.c"), "-o", 出,
  ], { encoding: "utf8", timeout: 300000 });
  ok("armclang 编得过", r.status === 0, String(r.stderr).slice(0, 300));
  ok("而且没有警告", String(r.stderr).trim() === "", String(r.stderr).slice(0, 300));
  if (fs.existsSync(出)) {
    const 大小 = fs.statSync(出).size;
    ok("产出了对象文件（一百千字节上下）", 大小 > 100 * 1024, String(大小));
  } else {
    ok("产出了对象文件（一百千字节上下）", false, "没有文件");
  }
  fs.rmSync(临, { recursive: true, force: true });
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
  ok("Flash 约一百六十千字节（含四张 Unicode 表）", Flash > 100 * 1024 && Flash < 220 * 1024, String(Flash));
  ok("RAM 常住在八千字节以内（含示例那四 KB 出口缓冲）", Ram > 0 && Ram < 8192, String(Ram));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
