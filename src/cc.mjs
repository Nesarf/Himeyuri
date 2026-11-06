// 编 vm/hmyr.c 的那条命令行里，平台相关的那两项。
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
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const 平台参数 = () =>
  process.platform === "win32" ? ["-Wl,--stack,67108864"] : ["-pthread"];


// ---- 编 C 机器：同一个文件编几十遍，收成一次 ----
//
// 为什么要有它（2026-11-06）：全量里五十七处各自 spawn 一次 gcc，编的都是同一个
// vm/hmyr.c，一次全量在上面花三百多秒 CPU。而那个文件与旗标在两次调用之间一个字
// 都没变 —— 与 tools/impact.mjs 那次「十六次调用重建同一张图」同一个形状，只是
// 那一次省的是两秒，这一次省的是几十秒。
//
// 键是「源码字节加旗标」：源码改了就重编，旗标改了就重编，其余情况直接复用产物。
// 缓存落在系统临时目录（不进仓库，也不进 .gitignore 的争论）。
//
// 返回值的形状与 spawnSync 一样（status / stderr / stdout），所以调用点只换一个名字：
//   spawnSync("gcc", ["-std=c11", "-O3", "-Wall", ...平台参数(), "-o", exe,
//                     path.join(ROOT, "vm/hmyr.c"), "-lm"], { encoding: "utf8" })
// 变成
//   编C机器(exe)
export const 编C机器 = (出, 额外旗标 = []) => {
  const 源路 = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "vm/hmyr.c");
  const 旗 = ["-std=c11", "-O3", "-Wall", ...平台参数(), ...额外旗标, "-lm"];
  let 键;
  try {
    键 = createHash("sha256")
      .update(fs.readFileSync(源路))
      .update(旗.join(" "))
      .digest("hex")
      .slice(0, 16);
  } catch (err) {
    键 = null;   // 读不到源码就老老实实走 gcc，让它自己报错
  }
  const 缓存 = 键 ? path.join(os.tmpdir(), "hmyr-cc", "hmyr-" + 键 + (process.platform === "win32" ? ".exe" : "")) : null;
  if (缓存 && fs.existsSync(缓存)) {
    try {
      fs.mkdirSync(path.dirname(出), { recursive: true });
      fs.copyFileSync(缓存, 出);
      return { status: 0, stderr: "", stdout: "" };
    } catch { /* 复制不过去就走 gcc，让真正的错冒出来 */ }
  }
  const r = spawnSync("gcc", [...旗, "-o", 出, 源路], { encoding: "utf8" });
  if (r.status === 0 && 缓存) {
    try {
      fs.mkdirSync(path.dirname(缓存), { recursive: true });
      fs.copyFileSync(出, 缓存);
    } catch { /* 存不进缓存不影响这一次 */ }
  }
  return r;
};
