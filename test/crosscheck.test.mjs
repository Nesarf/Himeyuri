// 报数工具的交叉判据：三处账之间必须自洽。
//
// 为什么要有这一份：2026-11-04 发现 tools/builtin-gap.mjs 的「自编」那一列
// 正则只认英文 true，而源码里写的是「真」—— 于是整列为空，汇总行报
// 「宿主有而自编没有：78 个」。那个数字看起来像一条大活，其实是尺子坏了，
// 而它坏了两个月没人发现，因为每一处账都只有自己的口径。
//
// 这一份钉的不是某一处的数字，是几处之间**必须成立的关系**。恒等式比期望值结实：
// 期望值随数据长大就要改，恒等式不用。
//
// 四条关系：
//   一、种子的字节数在三处相等 —— 文件本身、vm/pack_seed.h 里写的那一行、
//       independence 报出来的那一行。2026-11-04 换种子时就漏过 pack_seed.h 这一处。
//   二、builtin-gap 的「自编」那一列不能整列为空（这次事故的直接防线），
//       而且「宿主有而自编没有」必须是 0。
//   三、runtime-path 说「越界 0 处」与 independence 说「零工具」必须同时成立。
//   四、工具账本里「搬了」加「不搬」必须等于总数。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (label, condition, detail = "") => {
  if (condition) { passed++; console.log("  通过  " + label); }
  else { failed++; console.log("  不通过  " + label + (detail ? "  " + detail : "")); }
};

// 跑一个工具脚本，交回它的 stdout（失败时也交回 stdout —— 判据要能说出它看到了什么）。
const 跑 = (脚本, 参 = []) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", 脚本), ...参],
    { cwd: ROOT, encoding: "utf8", timeout: 600000 });
  return { 出: String(r.stdout || ""), 码: r.status, 错: String(r.stderr || "") };
};

// 从一段输出里取「某个词打头的那一行」的其余部分。
const 行 = (出, 名) => {
  const m = new RegExp("^\\s*" + 名 + "\\s+(.*)$", "m").exec(出);
  return m ? m[1].trim() : "";
};

console.log("一、种子字节数在三处相等");
{
  const 文件 = fs.statSync(path.join(ROOT, "bootstrap/pack.hmtn")).size;
  const 头 = fs.readFileSync(path.join(ROOT, "vm/pack_seed.h"), "utf8");
  const 头里 = /hmyr_pack_seed_len = (\d+);/.exec(头);
  const 独立 = 跑("independence.mjs");
  const 报的 = /^(\d+) 字节/.exec(行(独立.出, "种子"));
  ok("independence 跑得动", 独立.码 === 0, String(独立.错).slice(0, 140));
  ok("independence 报的种子字节数等于文件本身", !!报的 && Number(报的[1]) === 文件,
    (报的 ? 报的[1] : "没读到") + " 对 " + 文件);
  ok("vm/pack_seed.h 里写的长度等于文件本身", !!头里 && Number(头里[1]) === 文件,
    (头里 ? 头里[1] : "没读到") + " 对 " + 文件);
}

console.log("二、内置账：自编那一列不是空的，而且宿主有的它都认");
{
  const 账 = 跑("builtin-gap.mjs");
  ok("builtin-gap 跑得动", 账.码 === 0, String(账.错).slice(0, 140));
  // 「自编 N」出现在汇总行里。不要只检查「有数字」—— 要检查它不是 0：
  // 这一列整列为空过一次，而那次它的数字是 0。
  const 自编 = /· 自编 (\d+)/.exec(账.出);
  ok("汇总行里有自编的数", !!自编, 账.出.split("\n").filter((l) => l.includes("自编")).join(" / ").slice(0, 160));
  ok("自编那一列不是空的（这一次事故的直接防线）", !!自编 && Number(自编[1]) > 0,
    (自编 ? 自编[1] : "没读到") + " 个");
  const 缺 = 跑("builtin-gap.mjs", ["--missing"]);
  ok("builtin-gap --missing 跑得动", 缺.码 === 0, String(缺.错).slice(0, 140));
  ok("宿主有而 C 没有的是 0 个", /宿主有、C 那台没有的内置：0 个/.test(缺.出), 行(缺.出, "宿主有、C"));
  ok("宿主有而自举求值器没有的是 0 个", /宿主有、自举求值器没有：\s*0 个/.test(缺.出), 行(缺.出, "宿主有、自举"));
}

console.log("三、运行时路径：两个口径都说零");
{
  const 路 = 跑("runtime-path.mjs");
  ok("runtime-path 跑得动", 路.码 === 0, String(路.错).slice(0, 140));
  const 越界 = /越界 (\d+) 处/.exec(路.出);
  ok("runtime-path 报的越界是 0", !!越界 && Number(越界[1]) === 0, 越界 ? 越界[1] : "没读到");
  const 独立 = 跑("independence.mjs");
  const 那行 = 行(独立.出, "运行时路径");
  ok("independence 那行也写着零工具", 那行.includes("零工具"), 那行);
  // 两个口径一个说「越界 0 处」、一个说「零工具」—— 它们说的是同一件事，
  // 所以两个都零才算自洽；一边零一边不零，说明有一处的口径坏了。
  ok("两处对同一件事给出同一个结论",
    (越界 && Number(越界[1]) === 0) === 那行.includes("零工具"), 那行);
}

console.log("四、工具账本：搬了加不搬等于总数");
{
  const 本 = 跑("tooling-ledger.mjs");
  ok("tooling-ledger 跑得动", 本.码 === 0, String(本.错).slice(0, 140));
  const 总数 = /共 (\d+) 项/.exec(本.出);
  const 两半 = /搬了 (\d+) 项，不搬 (\d+) 项/.exec(本.出);
  ok("账本给出总数与两半", !!(总数 && 两半), (总数 ? 总数[1] : "-") + " / " + (两半 ? 两半[1] + "+" + 两半[2] : "-"));
  if (总数 && 两半) {
    ok("搬了加不搬等于总数", Number(两半[1]) + Number(两半[2]) === Number(总数[1]),
      Number(两半[1]) + " + " + Number(两半[2]) + " 对 " + Number(总数[1]));
  }
  // --check 是账本自己的口径（搬了的要有套件、不搬的要有理由）。它绿，加和才有意义。
  const 检 = 跑("tooling-ledger.mjs", ["--check"]);
  ok("账本自己的 --check 也是绿的", 检.码 === 0, String(检.出 || 检.错).slice(0, 160));
}

console.log("五、反向：把 pack_seed.h 里的长度改错一位，第一条恒等式必须不成立");
{
  // 一条判据若从没见过红，它就是个占位符。这里改的是最便宜的那一处 ——
  // 头文件里的长度那一行，而不动二进制本身：改完恒等式立刻不成立，
  // 而 with 别处的账一点关系都没有。
  const 头路 = path.join(ROOT, "vm/pack_seed.h");
  const 原 = fs.readFileSync(头路, "utf8");
  const 中 = /hmyr_pack_seed_len = (\d+);/.exec(原);
  if (!中) {
    ok("反向改动落到了位置（否则这一节什么都没验）", false, "没找到长度那一行");
  } else {
    const 坏 = 原.replace("hmyr_pack_seed_len = " + 中[1] + ";",
      "hmyr_pack_seed_len = " + (Number(中[1]) + 1) + ";");
    fs.writeFileSync(头路, 坏, "utf8");
    try {
      const 文件 = fs.statSync(path.join(ROOT, "bootstrap/pack.hmtn")).size;
      const 头里 = /hmyr_pack_seed_len = (\d+);/.exec(fs.readFileSync(头路, "utf8"));
      ok("改错一位之后恒等式就不成立（判据抓得住）",
        !!头里 && Number(头里[1]) !== 文件,
        (头里 ? 头里[1] : "没读到") + " 对 " + 文件);
    } finally {
      fs.writeFileSync(头路, 原, "utf8");
    }
  }
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);

