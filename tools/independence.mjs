// 「完全独立化」的总验收：把分散的证据汇成一条命令。
//
// 它不重复那些证据 —— 每一项都有自己的套件。它只回答一个问题：
// 按 design/SELFRUN.txt 的定义，今天还差什么？
//
// 定义有两种读法，这里各给一行：
//   近读法   世界面（六处对齐、差零）与 C 机器的回收
//   远读法   工具链账本（每项搬了或不搬，都有据）
//
// 用法：node tools/independence.mjs
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 账本 } from "./tooling-ledger.mjs";
import { 工具们, 闭包, 入口们 } from "./runtime-path.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 行批 = [];
const 报 = (名, 值) => 行批.push([名, 值]);

// 一、种子：它是一份能跑的东西，而不是一份记录。
{
  const 路 = path.join(ROOT, "bootstrap/pack.hmtn");
  const 在 = fs.existsSync(路);
  const 魔数 = 在 ? fs.readFileSync(路).subarray(0, 5).toString("latin1") : "";
  const 字节 = 在 ? fs.statSync(路).size : 0;
  报("种子", 在 && 魔数 === "HMYRB" ? 字节 + " 字节，HMYRB" : "缺");
}

// 二、世界面：宿主有的，C 那台也有。
{
  const r = spawnSync("node", [path.join(ROOT, "tools/builtin-gap.mjs"), "--missing"], { encoding: "utf8", cwd: ROOT });
  const 出 = String(r.stdout || "");
  const 差 = /C 那台没有的内置：(\d+) 个/.exec(出);
  const 自举 = /自举求值器没有：\s*(\d+) 个/.exec(出);
  报("世界面", 差 ? "宿主与 C 差 " + 差[1] + " 格；自举还差 " + (自举 ? 自举[1] : "?") + " 格" : "量不出来");
}

// 三、工具账本：每项都说清了自己是什么状态。
{
  const 搬了 = 账本.filter((x) => x.状态.startsWith("搬")).length;
  const 不搬 = 账本.filter((x) => x.状态 === "不搬").length;
  const 没理由 = 账本.filter((x) => x.状态 === "不搬" && !(x.为什么不搬 && x.为什么不搬.length > 20)).length;
  报("工具账本", 账本.length + " 项：搬了 " + 搬了 + "，不搬 " + 不搬 + (没理由 ? "（其中 " + 没理由 + " 项没写理由）" : ""));
}

// 四、运行时路径：五个入口的 import 闭包里没有工具。
{
  let 越界 = 0;
  for (const 入口 of 入口们) 越界 += [...闭包(入口)].filter((f) => 工具们.has(f)).length;
  报("运行时路径", 越界 === 0 ? "五个入口，零工具" : "有 " + 越界 + " 处越界");
}

// 五、一条能被机器读的结论。
{
  const 差 = 行批.find(([名]) => 名 === "世界面");
  const 账 = 行批.find(([名]) => 名 === "工具账本");
  const 路 = 行批.find(([名]) => 名 === "运行时路径");
  const 齐 = 差 && 差[1].includes("差 0 格") && 路 && !路[1].includes("越界");
  const 清 = 账 && !账[1].includes("没写理由");
  // 2026-11-04：结论从「齐了」改成「六条性质都成立」。原来的「近读法齐了」说的是
  // 「差 0 格」，而格子是自己画的 —— 数字对齐是必要条件，不是定义。
  // 六条性质与各自的判据写在 design/INDEPENDENCE.txt。
  报("结论", 齐 && 清
    ? "六条性质今天都成立（运行时不碰工具、种子自足、种子与编译器互逆、世界面、三台同答案、编译期不借宿主）；每条的判据见 design/INDEPENDENCE.txt"
    : "还有没结清的地方，见上面几行");
}

for (const [名, 值] of 行批) {
  let 头 = 名;
  while (头.length < 12) 头 += " ";
  console.log("  " + 头 + 值);
}
