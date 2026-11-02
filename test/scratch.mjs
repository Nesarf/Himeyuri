// 测试层往哪儿写临时文件：只有这一处知道默认值。
//
// 为什么要有这一页：2026-11-02 之前在二十多个测试文件里，每一处 mkdtempSync 都
// 把 E:/DaShaoHuo/cache/tmp 当成常量写死。那在 Windows 上没问题，而 WSL 里
// 同一个盘挂在 /mnt/e 下 —— 于是那些套件在第二个系统上一启动就连目录都建不出来，
// modules 那一套报的「produced no output at all」就是这个。那是「在 Linux 上跑
// 全量」真正的门槛，不是某一处代码假设了 Windows，是测试层的地基假设了它。
//
// 现在这一段是唯一知道「临时目录在哪」的地方，其余都问它。改默认值也改这一处。
import fs from "node:fs";

// process 不 import：它是 Node 的全局，而 `node:process` 不在 conformance 的
// 可移植集合里（那个集合只放行少数几个 node: 模块）。2026-11-02 第一次跑
// conform 就被它抓到了 —— 报的是「modules outside the portable set」。

// 临时目录：本机约定是不进 C 盘的那个，而 WSL 里同一块盘挂在 /mnt/e 下。
// 兜底给 /tmp：那条「不进 C 盘」的纪律本来就是针对这台 Windows 的。
export const 临时目录 = () => {
  const 候选 = [
    process.env.HMYR_TMP,
    process.platform === "win32" ? "E:/DaShaoHuo/cache/tmp" : "/mnt/e/DaShaoHuo/cache/tmp",
  ];
  for (const 路 of 候选) if (路 && fs.existsSync(路)) return 路;
  return "/tmp";
};

// mkdtempSync 的替身：前缀照旧写（"hmyr-mod-" 这种），目录由上面那一处决定。
export const 临时mkdtempSync = (前缀) => fs.mkdtempSync(临时目录() + "/" + 前缀);

// 一个固定的临时文件路径（不需要独占目录的场合）。
export const 临时文件 = (名) => 临时目录() + "/" + 名;
