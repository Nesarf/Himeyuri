// 编 vm/hmyr.c 的那条命令行：平台相关的那两项，以及「全量时只编一次」。
//
// 为什么要有这一页：2026-11-03 在 WSL（Nyarch Linux）里跑全量，四十套红，而其中
// 绝大多数的根因是同一个字符串 —— 每一套要编 C 机器的测试都自带一份
//
//   ["-std=c11", "-O3", "-Wall", "-Wl,--stack,67108864", ...]
//
// 而 -Wl,--stack 是 PE 链接器的选项，GNU ld 不认，于是一到 Linux 就
// "unrecognized option '--stack'"。全仓五十八处，散在 test/、bench/、tools/。
//
// 于是这里成了唯一知道那两个词的地方：
//
//   Windows  -Wl,--stack,67108864   栈大小是链接期的选项
//   POSIX    -pthread               线程要显式链上，而栈由 ulimit 定
//
// 与 test/scratch.mjs 同一课：重复的默认值就是未声明的假设。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const 平台参数 = () =>
  process.platform === "win32" ? ["-Wl,--stack,67108864"] : ["-pthread"];

// ---- 编 C 机器：全量时只编一次，各套件复制同一份 ----
//
// 为什么要有它（2026-11-06）：五十七处各自 spawn 一次 gcc 编同一个 vm/hmyr.c，
// 一次全量在上面花三百多秒 CPU。前两次尝试都在「复用」上失败，第三次才找到根因
// （design/CHECKING.txt 第十五到十九笔，最后一笔是它）：
//
//   spawnSync("…/hmyr") 在 Windows 上走 PATHEXT，只认 .exe。所以「只有无后缀的
//   hmyr」时它报 ENOENT —— 而 copyFileSync 恰恰只造出无后缀的那一份（gcc 会自己
//   加 .exe，copyFileSync 不会）。那四套失败正是因为它们把 exe 写成 (临, "hmyr")。
//
// 所以这一版复制之后补一份 .exe，与 gcc 的行为对齐。共享的只有一个只读路径、
// 一个写者（check-all 在起任何套件之前编好），没有并发写缓存那回事。
export const 编C机器 = (出, 额外旗标 = []) => {
  const 共用 = process.env.HMYR_EXE;
  if (共用 && fs.existsSync(共用)) {
    try {
      fs.mkdirSync(path.dirname(出), { recursive: true });
      fs.copyFileSync(共用, 出);
      // 无后缀的名字 spawnSync 看不见（见上面那段），所以照着 gcc 的样子补一份。
      if (process.platform === "win32" && !出.toLowerCase().endsWith(".exe")) {
        fs.copyFileSync(共用, 出 + ".exe");
      }
      return { status: 0, stderr: "", stdout: "" };
    } catch { /* 复制不过去就自己编，让真正的错冒出来 */ }
  }
  const 源路 = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "vm/hmyr.c");
  // 优化档位可切换：HMYR_CC=-O2 或 -O3，缺省 -O3。
  //
  // 为什么要有这个开关（2026-11-07）：-O3 换上去时量的是单跑（tree 24.7 秒对 30.4 秒），
  // 而全量里它看起来更慢。要判那一面得在同一条件下各跑一次全量，前提是旗标能切换 ——
  // 否则每次比较都要反向替换五十七处。与 HMYR_EXE 同一个形状：只认一个环境变量，
  // 缺省值就是今天的样子。
  const 档 = process.env.HMYR_CC === "-O2" ? "-O2" : "-O3";
  return spawnSync("gcc",
    ["-std=c11", 档, "-Wall", ...平台参数(), ...额外旗标, "-lm", "-o", 出, 源路],
    { encoding: "utf8" });
};
