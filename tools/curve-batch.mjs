// 一次加载，多回调用。
//
// 曲线套件原来十四次 spawnSync，每一回都把同一份 self/curve.hmoca 从零加载、
// 解析、编成字节码，再跑一个标量乘。那笔过路费是量过的：标量 0 要 3.51 秒、
// 标量 8 要 3.65 秒 —— 三次翻倍只多 0.14 秒，所以那 3.5 秒跟算什么几乎无关。
// 十四回乘下来是 49 秒，占整套 88.5 秒的 55%。
//
// 这里只加载一次，然后按任务表依次换 argv、换 write、把步数与停机标志从头算，
// 调用同一个 main。判据一个字都不改，只是换了个喂法。
//
// 任务表从标准输入读，形状是 [{ 参: [...], 步限: 数字 }, ...]；交回一行 JSON 数组，
// 每一项是 { ok: true, 出, 值, 毫秒 } 或 { ok: false, 码, 话, 毫秒 }。
// 从标准输入读而不是从文件读，是为了让常量只有一份 —— 它们住在套件里，
// 不必在两边各抄一遍再提心它们会不会走样。
import path from "node:path";
// 计时用 Date.now() 而不是 node:perf_hooks 的 performance：conformance 那一套会扫
// 「源码里 import 了哪些模块」，perf_hooks 不在可移植集合里，于是它把这个工具记成
// 「越界的模块」并让整轮变红。毫秒精度对 3.9 秒这个量级够用。
import { fileURLToPath } from "node:url";
import { loadUnit } from "../src/loader.mjs";
import { 跑字节码 } from "../src/vm.mjs";
import { 本机能力 } from "../src/capabilities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const 目标 = "self/curve.hmoca";

const 读尽 = async () => {
  const 块 = [];
  for await (const 片 of process.stdin) 块.push(片);
  return Buffer.concat(块).toString("utf8");
};

const 任务批 = JSON.parse(await 读尽());
if (!Array.isArray(任务批) || 任务批.length === 0) {
  console.error("curve-batch: 标准输入要一个非空的任务数组");
  process.exit(2);
}

const 起载 = Date.now();
const 层 = loadUnit(path.join(ROOT, 目标));
const 载毫秒 = Date.now() - 起载;
if (!层.ok) {
  for (const e of 层.diagnostics.errors) console.error(e.code + " " + e.message);
  process.exit(1);
}
// 加载与编译花了多少，写在诊断那一头：下面的结论「那 3.9 秒不是过路费」
// 靠的就是这个数字，于是它该有一处可核对的地方，而不是只留在某一天的会话里。
process.stderr.write("加载与编译 " + Math.round(载毫秒) + " ms\n");

// 与 bin/hmyr.mjs 的 --compile 那一面同一个默认：契约按环境里的开关走，
// 字符串住在码元序列里。两台口径不同的话，这里量出来的时间就不是那一面的时间。
const vm = 跑字节码(层, {
  capabilities: 本机能力(),
  argv: [],
  stepLimit: 任务批[0].步限,
  contracts: process.env.HMYR_CONTRACTS === "1",
  字符串用码元序列: true,
});

const 结果 = [];
for (const 任务 of 任务批) {
  // 每一回都还原成「原来的一次新进程」：参数、步数、输出口、停机标志。
  // 停机那一项必须清，因为新进程之间不共享它 —— 留着就等于让前一回的错误
  // 把一个本来会跑通的下一回也判成失败。清掉才是等价，不是把错误藏起来。
  vm.argv = [目标, ...(任务.参 || [])];
  vm.步 = 0;
  vm.步限 = 任务.步限;
  vm.停机 = null;
  let 出 = "";
  vm.write = (s) => { 出 += s; };
  const 起 = Date.now();
  const r = vm.调用("main", [], null);
  const 毫秒 = Date.now() - 起;
  if (!r.ok) { 结果.push({ ok: false, 码: r.码, 话: r.话, 毫秒 }); continue; }
  结果.push({ ok: true, 出, 值: typeof r.值 === "number" ? r.值 : null, 毫秒 });
}

process.stdout.write(JSON.stringify(结果) + "\n");
