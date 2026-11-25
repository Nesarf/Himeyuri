// 测试层往哪儿写临时文件：只有这一处知道默认值。
//
// 为什么要有这一页：2026-11-02 之前在二十多个测试文件里，每一处 mkdtempSync 都
// 把本机那条缓存路径当成常量写死。那在 Windows 上没问题，而 WSL 里
// 同一个盘挂在 /mnt/e 下 —— 于是那些套件在第二个系统上一启动就连目录都建不出来，
// modules 那一套报的「produced no output at all」就是这个。那是「在 Linux 上跑
// 全量」真正的门槛，不是某一处代码假设了 Windows，是测试层的地基假设了它。
//
// 现在这一段是唯一知道「临时目录在哪」的地方，其余都问它。改默认值也改这一处。
import fs from "node:fs";
import os from "node:os";

// process 不 import：它是 Node 的全局，而 `node:process` 不在 conformance 的
// 可移植集合里（那个集合只放行少数几个 node: 模块）。2026-11-02 第一次跑
// conform 就被它抓到了 —— 报的是「modules outside the portable set」。

// 临时目录：HMYR_TMP 优先（这台机器用它指到非系统盘的那个缓存目录），
// 否则用宿主给的临时目录。「不进 C 盘」那条纪律坐在环境变量里，不在仓库里 ——
// 源码里写死任何一台机器自己的位置，第二台机器上就起不来。
export const 临时目录 = () => {
  const 候选 = [process.env.HMYR_TMP, os.tmpdir()];
  for (const 路 of 候选) if (路 && fs.existsSync(路)) return 路;
  return "/tmp";
};

// mkdtempSync 的替身：前缀照旧写（"hmyr-mod-" 这种），目录由上面那一处决定。
export const 临时mkdtempSync = (前缀) => fs.mkdtempSync(临时目录() + "/" + 前缀);

// 一个固定的临时文件路径（不需要独占目录的场合）。
export const 临时文件 = (名) => 临时目录() + "/" + 名;
