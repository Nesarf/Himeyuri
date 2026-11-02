// 编 vm/hmyr.c 的那条命令行里，平台相关的那两项。
//
// 为什么要有这一页：2026-11-03 在 WSL（Nyarch Linux）里跑全量，四十套红，而其中
// 绝大多数的根因是同一个字符串 —— 每一套要编 C 机器的测试都自带一份
//
//   ["-std=c11", "-O2", "-Wall", "-Wl,--stack,67108864", ...]
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
export const 平台参数 = () =>
  process.platform === "win32" ? ["-Wl,--stack,67108864"] : ["-pthread"];
